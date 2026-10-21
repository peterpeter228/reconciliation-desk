import type { Bank_Deposit_Row, QB_Ledger_Entry } from '../contracts/canonical';
import type {
  AllocationClaim,
  EngineGroup,
  ReconcileInput,
  ReconcileResult,
  SearchScope,
} from '../contracts/engine';
import { normalize } from './normalize';
import { validatedEvidence } from './evidence';
import { buildControls } from './conservation';
import { contentHash } from './identities';
import { sumCents, feeInBand } from './money';
import { buildUnits, type CashUnit } from './units';
import { bankRefs, edge, receiptOptions, settlementOptions, RULE_VERSION } from './edges';
import { businessAdd } from './calendar';
import { boundedSubsetSum } from './subset';
import { diagnose, type GroupContext } from './diagnostics';

export function reconcile(input: ReconcileInput): ReconcileResult {
  const ctx = normalize(input);
  const ev = validatedEvidence(input, ctx);
  const units = buildUnits(ctx, ev);
  const windows = new Map(
    units.map((u) => [
      u.id,
      [
        businessAdd(u.anchor, -1, input.config?.calendar),
        businessAdd(u.anchor, 5, input.config?.calendar),
      ],
    ]),
  );
  const inUnitWindow = (u: CashUnit, date: string) => {
    const w = windows.get(u.id)!;
    return date >= w[0]! && date <= w[1]!;
  };
  const searches: SearchScope[] = [];
  const rejected_candidates: ReconcileResult['rejected_candidates'] = [];
  const pool: EngineGroup[] = [];
  const local = new Map<string, GroupContext>();
  const coveredUnits = new Set<string>();
  const started = performance.now();
  const controlsBefore = buildControls(input, ctx, []);
  const runFingerprint = contentHash({
    evidence: ev,
    manifests: input.manifests,
    config: input.config,
    rules: RULE_VERSION,
  });
  if (controlsBefore.accounts.some((a) => a.status === 'MISMATCH')) {
    ctx.blocked = true;
    ctx.warnings.push({
      code: 'ACCOUNT_ROLLFORWARD_MISMATCH',
      message: 'An account opening plus activity does not equal its reported closing balance.',
      source_ids: [],
      severity: 'BLOCKING',
    });
  }
  if (!controlsBefore.coverage_confirmed)
    ctx.warnings.push({
      code: 'INCOMPLETE_COVERAGE',
      message: 'Activity association only: complete source coverage has not been confirmed.',
      source_ids: [],
      severity: 'WARNING',
    });

  function addGroup(
    groupUnits: CashUnit[],
    banks: Bank_Deposit_Row[],
    cashIdentity: boolean,
    searchStatus: EngineGroup['search_status'] = 'COMPLETE',
    extraWarnings: string[] = [],
    explicitQB: QB_Ledger_Entry[] = [],
  ): void {
    const st = groupUnits.flatMap((u) => u.st);
    const stIds = st.map((s) => s.id).sort();
    const bankIds = banks.map((b) => b.id).sort();
    const refs = new Set(banks.flatMap(bankRefs));
    const components = ev.deposit_components.filter((c) => refs.has(c.deposit_reference));
    const ext = ev.external_receipts.filter(
      (e) =>
        refs.has(e.deposit_reference) &&
        !e.entered_in_st &&
        e.business_nature === 'CUSTOMER_RECEIPT' &&
        e.independently_verified,
    );
    // A manifest amount alone is not a receipt. Match its external component to an actual receipt register.
    let external = 0;
    const evidenceRefs = new Set(groupUnits.flatMap((u) => u.evidence_refs));
    if (components.length) {
      const componentIds = new Set<string>();
      for (const c of components) {
        if (componentIds.has(c.component_reference)) {
          extraWarnings.push('DUPLICATE_COMPONENT_ID');
          continue;
        }
        componentIds.add(c.component_reference);
        evidenceRefs.add(c.evidence_ref);
        if (!c.payment_id) {
          const rs = ext.filter(
            (e) =>
              e.amount_cents === c.net_cents &&
              (!e.check_number || e.check_number === c.component_reference),
          );
          if (rs.length === 1) {
            external = sumCents([external, rs[0]!.amount_cents]);
            evidenceRefs.add(rs[0]!.evidence_ref);
          } else extraWarnings.push('EXTERNAL_COMPONENT_RECEIPT_MISSING');
        }
      }
      if (
        components.some((c) => c.bank_amount_cents !== sumCents(banks.map((b) => b.signed_cents)))
      )
        extraWarnings.push('COMPONENT_BANK_CONTROL_MISMATCH');
      if (
        sumCents(components.map((c) => c.net_cents)) !== sumCents(banks.map((b) => b.signed_cents))
      )
        extraWarnings.push('INCOMPLETE_DEPOSIT_MANIFEST');
    } else if (!st.length && ext.length) {
      external = sumCents(ext.map((e) => e.amount_cents));
      for (const e of ext) evidenceRefs.add(e.evidence_ref);
      cashIdentity = true;
    }
    const gross = sumCents(groupUnits.map((u) => u.gross)),
      refunds = sumCents(groupUnits.map((u) => u.refunds)),
      fees = sumCents(groupUnits.map((u) => u.fees)),
      holds = sumCents(groupUnits.map((u) => u.holds)),
      releases = sumCents(groupUnits.map((u) => u.releases));
    const expected = sumCents([gross, -refunds, -fees, -holds, releases, external]);
    const bankAmount = sumCents(banks.map((b) => b.signed_cents));
    const cashEvidenced =
      (groupUnits.length > 0 && groupUnits.every((u) => u.cash_evidenced)) ||
      (!st.length && external > 0);
    const cashState = !banks.length
      ? 'ABSENT'
      : cashIdentity &&
          cashEvidenced &&
          expected === bankAmount &&
          extraWarnings.every(
            (w) =>
              ![
                'EXTERNAL_COMPONENT_RECEIPT_MISSING',
                'COMPONENT_BANK_CONTROL_MISMATCH',
                'INCOMPLETE_DEPOSIT_MANIFEST',
                'DUPLICATE_COMPONENT_ID',
              ].includes(w),
          )
        ? 'CONFIRMED'
        : 'CANDIDATE';
    const cash = edge(
      'ST_BANK_CASH',
      cashState,
      expected,
      bankAmount,
      [...stIds, ...bankIds],
      cashIdentity ? [...refs] : [],
      [...evidenceRefs],
      cashState === 'CONFIRMED'
        ? []
        : !banks.length
          ? ['POSTED_BANK_SETTLEMENT_NOT_FOUND']
          : ['DOCUMENTED_SETTLEMENT_COMPONENTS_AND_PAYOUT_IDENTITY'],
    );
    const receipts = receiptOptions(st, ctx, input),
      settlements = settlementOptions(banks, ctx, input, ev);
    for (const receipt of receipts)
      for (const settlement of settlements) {
        const batchIds = new Set(st.map((s) => s.accounting_batch_id).filter(Boolean));
        const feesQb = ctx.qb.filter(
          (q) =>
            q.role === 'FEE' &&
            ((q.accounting_batch_id && batchIds.has(q.accounting_batch_id)) ||
              (q.linked_deposit_id && refs.has(q.linked_deposit_id))),
        );
        const qb = [
          ...new Map(
            [...receipt.rows, ...settlement.rows, ...feesQb, ...explicitQB].map((q) => [q.id, q]),
          ).values(),
        ].sort((a, b) => a.id.localeCompare(b.id));
        const id = contentHash({
          st: stIds,
          qb: qb.map((q) => q.id),
          bank: bankIds,
          expected,
          external,
        });
        if (local.has(id)) continue;
        const accounts = [
          ...new Set(
            qb
              .filter(
                (q) =>
                  (q.role === 'CLEARING_RECEIPT' ||
                    q.role === 'CLEARING_SETTLEMENT' ||
                    q.role === 'FEE') &&
                  q.account_type === 'OTHER_CURRENT_ASSET',
              )
              .map((q) => q.account_id ?? q.account_full_name),
          ),
        ].sort();
        const residuals = accounts.map((account_id) => ({
          account_id,
          residual_debit_cents: sumCents(
            qb
              .filter((q) => (q.account_id ?? q.account_full_name) === account_id)
              .map((q) => q.signed_cents),
          ),
        }));
        const g: EngineGroup = {
          id,
          company_id: ctx.company,
          bank_account_id: ctx.bankAccount,
          clearing_account_ids: accounts,
          clearing_residuals: residuals,
          currency: 'USD',
          st_ids: stIds,
          qb_ids: qb.map((q) => q.id),
          bank_ids: bankIds,
          gross_cents: gross,
          refunds_cents: refunds,
          fees_cents: fees,
          holds_cents: holds,
          releases_cents: releases,
          external_receipts_cents: external,
          other_adjustments_cents: 0,
          bank_cents: bankAmount,
          unexplained_cents: expected - bankAmount,
          ledger_residual_cents: sumCents(residuals.map((r) => r.residual_debit_cents)),
          matching_state: 'UNMATCHED',
          matching_scope: 'ACTIVITY_BRIDGE',
          search_status: searchStatus,
          diagnoses: [],
          aje_state: 'INELIGIBLE',
          source_version_hash: contentHash({
            records: [...st, ...qb, ...banks].sort((a, b) => a.id.localeCompare(b.id)),
            run: runFingerprint,
          }),
          approved_proposal_hash: null,
          edges: [receipt.edge, settlement.edge, cash],
          accepted: false,
          warnings: [...extraWarnings],
          evidence_refs: [
            ...new Set([
              ...evidenceRefs,
              ...receipt.edge.evidence_refs,
              ...settlement.edge.evidence_refs,
            ]),
          ].sort(),
          fee_proposal_math_ready: false,
          fee_aje_draft_eligible: false,
          impact_cents: Math.max(
            Math.abs(expected - bankAmount),
            Math.abs(bankAmount),
            gross,
            refunds,
          ),
          period_status: st.length ? 'IN_PERIOD' : 'UNATTRIBUTED',
        };
        if (st.some((s) => s.export_mode === 'PAYMENT_TO_UF'))
          g.warnings.push('UF_PAYMENT_DEPOSIT_WORKSHEET_REQUIRED');
        if (
          banks.some((b) => !groupUnits.every((u) => inUnitWindow(u, b.posted_date))) &&
          cashIdentity
        )
          g.warnings.push('DATE_POLICY_REVIEW');
        pool.push(g);
        local.set(id, {
          st,
          qb,
          bank: banks,
          units: groupUnits,
          cashIdentity,
          component_refs: components.map((c) => c.id),
        });
        for (const u of groupUnits) coveredUnits.add(u.id);
      }
  }

  for (const b of ctx.bank) {
    const refs = bankRefs(b);
    const components = ev.deposit_components.filter((c) => refs.includes(c.deposit_reference));
    const memberIds = new Set(components.map((c) => c.payment_id).filter(Boolean));
    const strong = units.filter(
      (u) =>
        u.payout_refs.some((r) => refs.includes(r)) ||
        u.st.some((s) => s.source_payment_id && memberIds.has(s.source_payment_id)),
    );
    if (strong.length) {
      addGroup(
        strong,
        [b],
        true,
        'COMPLETE',
        b.granularity === 'DAILY_SUMMARY' && !components.length
          ? ['DAILY_SUMMARY_MEMBERSHIP_REQUIRED']
          : [],
      );
      continue;
    }
    const candidates = units.filter((u) => {
      if (u.payout_refs.length) {
        if (u.net === b.signed_cents && inUnitWindow(u, b.posted_date))
          rejected_candidates.push({
            source_ids: [...u.st.map((s) => s.id), b.id],
            reason: 'KNOWN_PAYOUT_ID_CONFLICT',
          });
        return false;
      }
      return (
        inUnitWindow(u, b.posted_date) &&
        (u.net === 0 || Math.sign(u.net) === Math.sign(b.signed_cents))
      );
    });
    const direct = candidates.filter((u) => u.net === b.signed_cents);
    for (const u of direct) addGroup([u], [b], false);
    const feeCandidates = candidates.filter(
      (u) =>
        u.net > 0 &&
        b.signed_cents > 0 &&
        u.st.every((s) => s.fee_mode !== 'SEPARATE_INVOICE') &&
        u.holds === 0 &&
        feeInBand(u.gross, u.gross - u.refunds - b.signed_cents, u.method),
    );
    for (const u of feeCandidates)
      addGroup([u], [b], false, 'COMPLETE', ['FEE_RATE_HYPOTHESIS_NOT_PROOF']);
    // Candidate-only search never mixes known merchants or processors. Unknown bank metadata cannot manufacture identity.
    if (b.signed_cents > 0) {
      const positive = candidates.filter((u) => u.net > 0 && u.net <= b.signed_cents);
      const buckets = new Map<string, CashUnit[]>();
      for (const u of positive) {
        const key = JSON.stringify([u.processor, u.merchant, u.method]);
        buckets.set(key, [...(buckets.get(key) ?? []), u]);
      }
      for (const bucket of buckets.values()) {
        if (bucket.length < 2) continue;
        const remaining =
          (input.config?.search?.total_budget_ms ?? 400) - (performance.now() - started);
        const search = boundedSubsetSum(
          bucket.map((u) => ({ id: u.id, cents: u.net })),
          b.signed_cents,
          {
            ...input.config?.search,
            budget_ms: Math.max(0, Math.min(input.config?.search?.budget_ms ?? 80, remaining)),
          },
        );
        const status =
          search.status === 'NO_MATCH' || search.status === 'UNIQUE_CANDIDATE'
            ? 'COMPLETE'
            : search.status;
        const scope: SearchScope = {
          id: contentHash({ bank: b.id, units: bucket.map((u) => u.id) }),
          bank_ids: [b.id],
          candidate_ids: bucket.flatMap((u) => u.st.map((s) => s.id)).sort(),
          status,
          solution_ids: search.solutions,
          visited_nodes: search.visited_nodes,
          complete: search.complete,
        };
        searches.push(scope);
        for (const solution of search.solutions)
          addGroup(
            bucket.filter((u) => solution.includes(u.id)),
            [b],
            false,
            status,
            ['ARITHMETIC_SUBSET_IS_NOT_IDENTITY'],
          );
      }
    }
    if (!pool.some((g) => g.bank_ids.includes(b.id))) addGroup([], [b], false);
  }
  // Keep absent-bank cases visible; E1 ownership may still be proved independently.
  for (const u of units) if (!coveredUnits.has(u.id)) addGroup([u], [], false);
  const referencedQb = new Set(pool.flatMap((g) => g.qb_ids));
  for (const q of ctx.qb)
    if (!referencedQb.has(q.id))
      addGroup([], [], false, 'COMPLETE', ['UNATTRIBUTED_QB_ACTIVITY'], [q]);

  // Never choose the first candidate. Every shared exclusive atom connects a conflict component.
  const owners = new Map<string, number[]>();
  pool.forEach((g, i) => {
    for (const id of [...g.st_ids, ...g.qb_ids, ...g.bank_ids])
      owners.set(id, [...(owners.get(id) ?? []), i]);
  });
  const parent = pool.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = root(a),
      rb = root(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (const ids of owners.values()) for (let i = 1; i < ids.length; i++) union(ids[0]!, ids[i]!);
  const components = new Map<number, EngineGroup[]>();
  pool.forEach((g, i) => {
    const key = root(i);
    components.set(key, [...(components.get(key) ?? []), g]);
  });
  for (const groups of components.values()) {
    const atomIds = new Set(groups.flatMap((g) => [...g.st_ids, ...g.qb_ids, ...g.bank_ids]));
    const unfinished = searches.filter(
      (s) =>
        !s.complete &&
        s.status !== 'AMBIGUOUS' &&
        [...s.candidate_ids, ...s.bank_ids].some((id) => atomIds.has(id)),
    );
    const competing = groups.length > 1;
    for (const g of groups) {
      if (ctx.blocked) {
        g.matching_state = 'BLOCKED';
        g.warnings.push('SOURCE_QUALITY_GATE_BLOCKED');
        continue;
      }
      if (competing) {
        g.matching_state = 'AMBIGUOUS';
        g.search_status = 'AMBIGUOUS';
        g.warnings.push('COMPETING_EXCLUSIVE_SOURCE_CLAIMS');
        continue;
      }
      if (unfinished.length) {
        g.matching_state = 'CANDIDATE';
        g.search_status = unfinished[0]!.status;
        g.warnings.push('SEARCH_INCOMPLETE_NO_ALLOCATION');
        continue;
      }
      const info = local.get(g.id)!;
      const cash = g.edges[2]!,
        receipt = g.edges[0]!,
        settlement = g.edges[1]!;
      const stConfirmed =
        !g.st_ids.length || receipt.state === 'CONFIRMED' || cash.state === 'CONFIRMED';
      const bankConfirmed =
        !g.bank_ids.length ||
        cash.state === 'CONFIRMED' ||
        (g.st_ids.length === 0 && ['CONFIRMED', 'SUPPORTED'].includes(settlement.state));
      const linkedIdentity = !g.st_ids.length || !g.bank_ids.length || cash.state === 'CONFIRMED';
      const hasProved = g.edges.some((e) => e.state === 'CONFIRMED' || e.state === 'SUPPORTED');
      const nonContradiction = !g.edges.some((e) => e.state === 'CONTRADICTED');
      const summaryAllowed =
        !info.bank.some((b) => b.granularity === 'DAILY_SUMMARY') || info.component_refs.length > 0;
      g.accepted =
        stConfirmed &&
        bankConfirmed &&
        linkedIdentity &&
        hasProved &&
        nonContradiction &&
        summaryAllowed &&
        g.search_status === 'COMPLETE';
      if (g.accepted) {
        g.matching_state =
          g.edges.every((e) => e.state === 'CONFIRMED') &&
          controlsBefore.coverage_confirmed &&
          g.unexplained_cents === 0
            ? 'MATCHED'
            : 'PARTIAL';
        if (g.matching_state === 'MATCHED') g.matching_scope = 'VERIFIED_THREE_WAY';
      } else
        g.matching_state =
          g.st_ids.length && g.bank_ids.length ? 'CANDIDATE' : hasProved ? 'PARTIAL' : 'UNMATCHED';
    }
  }
  const allocations: AllocationClaim[] = [];
  for (const g of pool) {
    const info = local.get(g.id)!;
    if (g.accepted) {
      for (const r of info.st)
        allocations.push({
          atom_id: r.id,
          group_id: g.id,
          signed_allocated_cents: r.gross_cents,
          component_id: null,
          split_authorization_ref: null,
        });
      for (const r of info.qb)
        allocations.push({
          atom_id: r.id,
          group_id: g.id,
          signed_allocated_cents: r.signed_cents,
          component_id: null,
          split_authorization_ref: null,
        });
      for (const r of info.bank)
        allocations.push({
          atom_id: r.id,
          group_id: g.id,
          signed_allocated_cents: r.signed_cents,
          component_id: null,
          split_authorization_ref: null,
        });
    }
    diagnose(g, info, input, ctx, ev);
  }
  const controls = buildControls(input, ctx, allocations);
  const groups = pool.sort((a, b) => b.impact_cents - a.impact_cents || a.id.localeCompare(b.id));
  return {
    groups,
    controls,
    warnings: ctx.warnings,
    allocations: allocations.sort((a, b) => a.atom_id.localeCompare(b.atom_id)),
    searches: searches.sort((a, b) => a.id.localeCompare(b.id)),
    rejected_candidates,
    versions: {
      engine: '1.0.0-g1',
      rules: RULE_VERSION,
      calendar: input.config?.calendar?.version ?? 'fed-settlement-v1',
      mapping: [
        ...new Set(
          [...ctx.st, ...ctx.qb, ...ctx.bank].flatMap((r) =>
            r.source_refs.map((p) => p.mapping_version),
          ),
        ),
      ].sort(),
    },
  };
}
