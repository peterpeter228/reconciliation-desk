import type { Bank_Deposit_Row, QB_Ledger_Entry, ST_Payment_Record } from '../contracts/canonical';
import type { EdgeAssessment, EvidenceBundle, ReconcileInput } from '../contracts/engine';
import type { Normalized } from './normalize';
import { inWindow } from './calendar';
import { sumCents } from './money';
export const RULE_VERSION = 'g1-2026.10.21.1';
export function edge(
  kind: EdgeAssessment['kind'],
  state: EdgeAssessment['state'],
  expected: number,
  observed: number,
  source_ids: string[],
  identity_refs: string[] = [],
  evidence_refs: string[] = [],
  missing_evidence: string[] = [],
): EdgeAssessment {
  return {
    kind,
    state,
    expected_cents: expected,
    observed_cents: observed,
    difference_cents: expected - observed,
    source_ids: [...new Set(source_ids)].sort(),
    identity_refs: [...new Set(identity_refs)].sort(),
    evidence_refs: [...new Set(evidence_refs)].sort(),
    missing_evidence,
    rule_id: `${kind.toLowerCase()}_v1`,
    rule_version: RULE_VERSION,
  };
}
export function bankRefs(b: Bank_Deposit_Row): string[] {
  return [...new Set([b.deposit_id, b.trace_id].filter((v): v is string => !!v))];
}
export interface ReceiptOption {
  edge: EdgeAssessment;
  rows: QB_Ledger_Entry[];
}
export function receiptOptions(
  st: ST_Payment_Record[],
  ctx: Normalized,
  input: ReconcileInput,
): ReceiptOption[] {
  const cash = st.filter((r) => r.record_type !== 'PAYMENT_CORRECTION');
  const expected = sumCents(cash.map((r) => r.gross_cents));
  if (!cash.length)
    return [
      {
        edge: edge('ST_QB_RECEIPT', 'ABSENT', 0, 0, [], [], [], ['ST_RECEIPT_NOT_FOUND']),
        rows: [],
      },
    ];
  if (cash.some((r) => !['JE_TO_CLEARING', 'PAYMENT_TO_UF'].includes(r.export_mode)))
    return [
      {
        edge: edge(
          'ST_QB_RECEIPT',
          'ABSENT',
          expected,
          0,
          cash.map((r) => r.id),
          [],
          [],
          ['EXPECTED_QB_OBJECT_AND_ACCOUNTING_EFFECT'],
        ),
        rows: [],
      },
    ];
  const ids = new Set(cash.map((r) => r.source_payment_id).filter(Boolean)),
    batches = new Set(cash.map((r) => r.accounting_batch_id).filter(Boolean));
  const pool = ctx.qb.filter(
    (q) =>
      q.role === 'CLEARING_RECEIPT' &&
      q.account_type === 'OTHER_CURRENT_ASSET' &&
      ((q.linked_payment_id && ids.has(q.linked_payment_id)) ||
        (q.accounting_batch_id && batches.has(q.accounting_batch_id))),
  );
  const identity = [...batches]
    .map((b) => `accounting_batch:${b}`)
    .concat([...ids].map((p) => `payment:${p}`));
  if (pool.length) {
    // A whole documented batch includes all eligible members, never an arbitrary subset.
    const incomplete = [...batches].some((b) =>
      ctx.st.some(
        (r) => r.record_type === 'PAYMENT' && r.accounting_batch_id === b && !cash.includes(r),
      ),
    );
    const make = (rows: QB_Ledger_Entry[]): ReceiptOption => {
      const observed = sumCents(rows.map((r) => r.signed_cents));
      return {
        rows,
        edge: edge(
          'ST_QB_RECEIPT',
          !incomplete && observed === expected ? 'CONFIRMED' : 'CONTRADICTED',
          expected,
          observed,
          [...cash.map((r) => r.id), ...rows.map((r) => r.id)],
          identity,
          [],
          incomplete
            ? ['COMPLETE_BATCH_MEMBERSHIP']
            : observed !== expected
              ? ['ST_QB_VARIANCE']
              : [],
        ),
      };
    };
    if (sumCents(pool.map((r) => r.signed_cents)) === expected) return [make(pool)];
    const txs = new Map<string, QB_Ledger_Entry[]>();
    for (const q of pool) {
      const key = JSON.stringify([q.transaction_id ?? q.id, q.account_id ?? q.account_full_name]);
      txs.set(key, [...(txs.get(key) ?? []), q]);
    }
    const exact = [...txs.values()].filter(
      (rs) => sumCents(rs.map((r) => r.signed_cents)) === expected,
    );
    return exact.length ? exact.map(make) : [make(pool)];
  }
  const matches = ctx.qb.filter(
    (q) =>
      q.role === 'CLEARING_RECEIPT' &&
      q.account_type === 'OTHER_CURRENT_ASSET' &&
      !q.linked_payment_id &&
      !q.accounting_batch_id &&
      q.signed_cents === expected &&
      cash.some((s) => inWindow(s.payment_date, q.posting_date, input.config?.calendar)),
  );
  if (matches.length)
    return matches.map((q) => ({
      rows: [q],
      edge: edge(
        'ST_QB_RECEIPT',
        'CANDIDATE',
        expected,
        q.signed_cents,
        [...cash.map((r) => r.id), q.id],
        [],
        [],
        ['RELIABLE_PAYMENT_OR_BATCH_ID'],
      ),
    }));
  return [
    {
      rows: [],
      edge: edge(
        'ST_QB_RECEIPT',
        'ABSENT',
        expected,
        0,
        cash.map((r) => r.id),
        [],
        [],
        ['QB_RECEIPT_NOT_FOUND'],
      ),
    },
  ];
}
export interface SettlementOption {
  edge: EdgeAssessment;
  rows: QB_Ledger_Entry[];
}
export function settlementOptions(
  banks: Bank_Deposit_Row[],
  ctx: Normalized,
  input: ReconcileInput,
  evidence: Required<EvidenceBundle>,
): SettlementOption[] {
  const observed = sumCents(banks.map((r) => r.signed_cents));
  if (!banks.length)
    return [
      {
        rows: [],
        edge: edge(
          'QB_BANK_SETTLEMENT',
          'ABSENT',
          0,
          0,
          [],
          [],
          [],
          ['POSTED_BANK_SETTLEMENT_NOT_FOUND'],
        ),
      },
    ];
  const refs = new Set(banks.flatMap(bankRefs));
  const linked = ctx.qb.filter(
    (q) =>
      (q.role === 'CLEARING_SETTLEMENT' || q.role === 'BANK') &&
      q.linked_deposit_id &&
      refs.has(q.linked_deposit_id),
  );
  const txs = new Map<string, QB_Ledger_Entry[]>();
  for (const q of linked) {
    const key = q.transaction_id ?? q.id;
    txs.set(key, [...(txs.get(key) ?? []), q]);
  }
  const options: SettlementOption[] = [];
  for (const [tx, initial] of txs) {
    const rows = ctx.qb.filter((q) => q.transaction_id === tx || initial.includes(q));
    const bankLegs = rows.filter(
      (q) =>
        q.role === 'BANK' &&
        q.account_type === 'BANK' &&
        (q.account_id === ctx.bankAccount ||
          (input.config?.qb_bank_account_names ?? []).includes(q.account_full_name)),
    );
    const clearing = rows.filter(
      (q) => q.role === 'CLEARING_SETTLEMENT' && q.account_type === 'OTHER_CURRENT_ASSET',
    );
    const confirmation = evidence.confirmations.find(
      (c) => c.qb_transaction_id === tx && refs.has(c.deposit_reference),
    );
    const splitSupported =
      input.config?.clearing_split_semantics_confirmed &&
      clearing.length > 0 &&
      clearing.every(
        (q) =>
          !!q.split_account &&
          q.split_account !== '-Split-' &&
          (input.config?.qb_bank_account_names ?? []).includes(q.split_account),
      );
    const amount = bankLegs.length
      ? sumCents(bankLegs.map((q) => q.signed_cents))
      : confirmation
        ? confirmation.bank_effect_cents
        : splitSupported
          ? -sumCents(clearing.map((q) => q.signed_cents))
          : 0;
    const supported = bankLegs.length > 0 || !!confirmation || !!splitSupported;
    const state: EdgeAssessment['state'] = !supported
      ? 'CANDIDATE'
      : amount !== observed
        ? 'CONTRADICTED'
        : bankLegs.length || confirmation
          ? 'CONFIRMED'
          : 'SUPPORTED';
    options.push({
      rows: rows.filter((q) => ['BANK', 'CLEARING_SETTLEMENT', 'FEE'].includes(q.role)),
      edge: edge(
        'QB_BANK_SETTLEMENT',
        state,
        amount,
        observed,
        [...banks.map((r) => r.id), ...rows.map((r) => r.id)],
        [...refs],
        confirmation ? [confirmation.evidence_ref] : [],
        state === 'SUPPORTED' || !supported
          ? ['QB_BANK_LEG_OR_ITEMIZED_ACCOUNTANT_CONFIRMATION']
          : state === 'CONTRADICTED'
            ? ['QB_BANK_AMOUNT_VARIANCE']
            : [],
      ),
    });
  }
  if (options.length) return options;
  return [
    {
      rows: [],
      edge: edge(
        'QB_BANK_SETTLEMENT',
        'ABSENT',
        0,
        observed,
        banks.map((r) => r.id),
        [],
        [],
        ['QB_SETTLEMENT_IDENTITY_AND_BANK_LEG'],
      ),
    },
  ];
}
