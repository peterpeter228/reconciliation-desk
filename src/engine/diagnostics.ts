import type {
  Bank_Deposit_Row,
  QB_Ledger_Entry,
  ST_Payment_Record,
  ReconciliationGroup,
} from '../contracts/canonical';
import type { EngineGroup, EvidenceBundle, ReconcileInput } from '../contracts/engine';
import type { Normalized } from './normalize';
import type { CashUnit } from './units';
import { businessAdd } from './calendar';
import { feeInBand, sumCents } from './money';
import { isFinalSettlement } from './evidence';
export interface GroupContext {
  st: ST_Payment_Record[];
  qb: QB_Ledger_Entry[];
  bank: Bank_Deposit_Row[];
  units: CashUnit[];
  cashIdentity: boolean;
  component_refs: string[];
}
export function diagnose(
  group: EngineGroup,
  local: GroupContext,
  input: ReconcileInput,
  ctx: Normalized,
  ev: Required<EvidenceBundle>,
): void {
  const { st, qb, bank, units } = local;
  const paymentIds = new Set(st.map((s) => s.source_payment_id));
  const refs = new Set(bank.flatMap((b) => [b.deposit_id, b.trace_id]).filter(Boolean));
  const settlements = ev.settlements.filter((s) => paymentIds.has(s.payment_id));
  const confirmations = ev.confirmations.filter(
    (c) =>
      refs.has(c.deposit_reference) && qb.some((q) => q.transaction_id === c.qb_transaction_id),
  );
  const cashEdge = group.edges.find((e) => e.kind === 'ST_BANK_CASH')!,
    receiptEdge = group.edges.find((e) => e.kind === 'ST_QB_RECEIPT')!,
    bankEdge = group.edges.find((e) => e.kind === 'QB_BANK_SETTLEMENT')!;
  const noConflict = group.accepted && group.search_status === 'COMPLETE' && !ctx.blocked;
  const independent =
    new Set([...st, ...qb, ...bank].flatMap((r) => r.source_refs.map((p) => p.file_sha256))).size >
    1;
  const score = (identity: boolean, exact: boolean, support: boolean) =>
    Math.max(
      0,
      Math.min(
        100,
        (identity ? 35 : 0) +
          (exact ? 20 : 0) +
          (support && independent ? 15 : 0) +
          10 +
          10 +
          (noConflict ? 10 : 0) -
          (group.matching_state === 'BLOCKED' ? 40 : 0),
      ),
    );
  const add = (
    cause: ReconciliationGroup['diagnoses'][number]['cause'],
    level: ReconciliationGroup['diagnoses'][number]['evidence_level'],
    evidence_refs: string[],
    missing_evidence: string[],
    identity = local.cashIdentity,
    exact = group.unexplained_cents === 0,
    support = evidence_refs.length > 0,
  ) => {
    const points = score(identity, exact, support);
    const evidence_level =
      level === 'CONFIRMED' && (!noConflict || points < 90) ? 'SUPPORTED' : level;
    group.diagnoses.push({
      cause,
      evidence_level,
      score: points,
      evidence_refs: [...new Set(evidence_refs)].sort(),
      missing_evidence: [...new Set(missing_evidence)],
    });
  };
  const coverage = (source: string) =>
    input.manifests.filter((m) =>
      source === 'QB' ? ['QBO', 'QBD'].includes(m.source_system) : m.source_system === source,
    );
  const bankManifests = coverage('BANK'),
    stCovered = coverage('ST').some((m) => m.coverage_confirmed);
  const through =
    bankManifests
      .map((m) => m.as_of_date)
      .sort()
      .at(-1) ?? '';
  const cutoff =
    input.config?.period_cutoff ?? bankManifests.map((m) => m.period_end).sort()[0] ?? '';
  const fullBank = bankManifests.length > 0 && bankManifests.every((m) => m.coverage_confirmed);
  const actualAfter =
    bank.some((b) => cutoff && b.posted_date > cutoff) && st.some((s) => s.payment_date <= cutoff);
  if (actualAfter) {
    group.period_status = 'SETTLED_AFTER_CUTOFF';
    const confirmed =
      cashEdge.state === 'CONFIRMED' &&
      receiptEdge.state === 'CONFIRMED' &&
      fullBank &&
      bankManifests.some((m) => m.period_start <= cutoff && m.period_end >= cutoff) &&
      bankManifests.some((m) => bank.every((b) => b.posted_date <= m.as_of_date));
    add(
      'DATE_LAG',
      confirmed ? 'CONFIRMED' : 'SUPPORTED',
      group.evidence_refs,
      confirmed
        ? []
        : ['COMPLETE_CUTOFF_AND_FOLLOWING_PERIOD_BANK_COVERAGE', 'SAME_PAYOUT_RECEIPT_IDENTITY'],
    );
  } else if (st.length && !bank.length && group.gross_cents > 0) {
    const due = st
      .map(
        (s) =>
          s.expected_settlement_date ??
          settlements.find((e) => e.payment_id === s.source_payment_id)
            ?.scheduled_settlement_date ??
          businessAdd(s.batch_close_date ?? s.payment_date, 5, input.config?.calendar),
      )
      .sort()
      .at(-1)!;
    group.period_status = through && through > due ? 'OVERDUE_UNSETTLED' : 'EXPECTED_IN_TRANSIT';
    group.warnings.push('MISSING_SETTLEMENT', group.period_status);
    add(
      'DATE_LAG',
      fullBank ? 'SUPPORTED' : 'SUSPECTED',
      [],
      ['FOLLOWING_PERIOD_POSTED_BANK_OR_PROCESSOR_SETTLEMENT'],
      receiptEdge.state === 'CONFIRMED',
      false,
      false,
    );
  }
  const hold = settlements.filter((s) => s.status === 'HELD' && s.held_cents > 0);
  if (hold.length) {
    const released = bank.some((b) =>
      hold.some((h) => [b.deposit_id, b.trace_id].includes(h.settlement_reference)),
    );
    const valid =
      hold.every((h) => h.release_coverage_confirmed && fullBank && through >= h.as_of_date) &&
      !released;
    add(
      'PROCESSOR_HOLD',
      valid ? 'CONFIRMED' : 'SUPPORTED',
      hold.map((h) => h.evidence_ref),
      valid ? [] : ['BANK_AND_PROCESSOR_RELEASE_COVERAGE_THROUGH_HOLD_AS_OF'],
      true,
      hold.every((h) => h.held_cents > 0 && h.held_cents <= h.gross_cents),
    );
  }
  // A documented reserve/hold is not a fee, even when its percentage resembles a fee band.
  const documentedFee =
    (group.fees_cents > 0 &&
      settlements.some(
        (s) => isFinalSettlement(s) && (s.fee_cents ?? 0) > 0 && s.fee_mode === 'NETTED',
      )) ||
    ev.deposit_components.some(
      (c) => paymentIds.has(c.payment_id) && c.fee_cents > 0 && c.fee_mode === 'NETTED',
    );
  const recordedFee =
    qb.some((q) => q.role === 'FEE') &&
    group.clearing_residuals.every((a) => a.residual_debit_cents === 0);
  if (documentedFee && !recordedFee) {
    const expenseReviewed = confirmations.some(
      (c) => c.expense_coverage_confirmed && c.fee_not_recorded,
    );
    const exactResidual =
      group.clearing_residuals.length === 1 &&
      group.clearing_residuals[0]!.residual_debit_cents === group.fees_cents;
    const full =
      bankEdge.state === 'CONFIRMED' &&
      cashEdge.state === 'CONFIRMED' &&
      receiptEdge.state === 'CONFIRMED' &&
      expenseReviewed &&
      exactResidual;
    group.fee_proposal_math_ready =
      group.unexplained_cents === 0 &&
      cashEdge.state === 'CONFIRMED' &&
      group.fees_cents > 0 &&
      group.gross_cents -
        group.refunds_cents -
        group.fees_cents -
        group.holds_cents +
        group.releases_cents +
        group.external_receipts_cents ===
        group.bank_cents;
    add(
      'NET_FEE_DRIFT',
      full ? 'CONFIRMED' : 'SUPPORTED',
      group.evidence_refs,
      full
        ? []
        : [
            ...(bankEdge.state !== 'CONFIRMED' ? ['QB_ACTUAL_BANK_POSTING'] : []),
            ...(!expenseReviewed ? ['COMPLETE_EXPENSE_AND_DUPLICATE_FEE_REVIEW'] : []),
            ...(!exactResidual ? ['ITEMIZED_CLEARING_RESIDUAL_EQUALS_COMPONENT_FEE'] : []),
          ],
    );
    const approvedAccounts = confirmations.some(
      (c) =>
        c.accounts_verified &&
        c.period_open &&
        c.fee_account_name &&
        c.clearing_account_id === group.clearing_residuals[0]?.account_id,
    );
    const ordinary =
      st.every((s) => s.export_mode === 'JE_TO_CLEARING') &&
      qb
        .filter((q) => q.role === 'CLEARING_RECEIPT' || q.role === 'CLEARING_SETTLEMENT')
        .every((q) => q.account_type === 'OTHER_CURRENT_ASSET');
    group.fee_aje_draft_eligible =
      full && noConflict && approvedAccounts && ordinary && group.unexplained_cents === 0;
    if (group.fee_aje_draft_eligible) group.aje_state = 'DRAFT';
  } else if (
    !documentedFee &&
    group.holds_cents === 0 &&
    st.length &&
    bank.length &&
    units.length === 1 &&
    st.every((s) => s.fee_mode !== 'SEPARATE_INVOICE')
  ) {
    const difference = group.gross_cents - group.refunds_cents - group.bank_cents;
    if (feeInBand(group.gross_cents, difference, units[0]!.method))
      add(
        'NET_FEE_DRIFT',
        'SUSPECTED',
        [],
        ['EXACT_NETTED_SETTLEMENT_FEE', 'QB_BANK_POSTING_AND_EXPENSE_REVIEW'],
        local.cashIdentity,
        false,
        false,
      );
  }
  const refunds = st.filter(
    (s) =>
      s.record_type === 'REFUND' &&
      s.payment_status === 'SUCCESS' &&
      (!s.accounting_batch_id || s.export_status === 'PENDING'),
  );
  if (refunds.length) {
    const refundEvidence = refunds.map((refund) => ({
      settlement: settlements.find(
        (s) => s.payment_id === refund.source_payment_id && s.status === 'REFUNDED',
      ),
      confirmation: confirmations.find(
        (c) =>
          !!refund.source_payment_id &&
          c.refund_payment_id === refund.source_payment_id &&
          c.refund_coverage_confirmed &&
          c.refund_not_recorded &&
          c.batching_due_date &&
          through > c.batching_due_date,
      ),
    }));
    const allSettled = refundEvidence.every((e) => !!e.settlement);
    const allReviewed = refundEvidence.every((e) => !!e.confirmation);
    const full = allSettled && allReviewed && cashEdge.state === 'CONFIRMED';
    add(
      'UNBATCHED_REFUND',
      full ? 'CONFIRMED' : refundEvidence.some((e) => !!e.settlement) ? 'SUPPORTED' : 'SUSPECTED',
      refundEvidence.flatMap((e) =>
        [e.settlement?.evidence_ref, e.confirmation?.evidence_ref].filter(
          (ref): ref is string => !!ref,
        ),
      ),
      full
        ? []
        : [
            ...(!allSettled ? ['SUCCESSFUL_ITEMIZED_REFUND_SETTLEMENT'] : []),
            ...(!allReviewed
              ? ['QB_REFUND_OBJECT_AND_ACCOUNT_COVERAGE', 'BATCHING_EXPORT_DUE_PASSED']
              : []),
            ...(cashEdge.state !== 'CONFIRMED' ? ['CONFIRMED_REFUND_CASH_MOVEMENT'] : []),
          ],
      allSettled,
      allSettled,
    );
    group.warnings.push('UNEXPORTED_REFUND_RECORD');
  }
  const audits = ev.audit_events.filter((a) => paymentIds.has(a.original_payment_id));
  const corrections = ctx.st.filter(
    (s) => s.record_type === 'PAYMENT_CORRECTION' && paymentIds.has(s.original_payment_id),
  );
  if (audits.length || corrections.length) {
    const after = audits.filter((a) => Date.parse(a.event_at) > Date.parse(a.original_exported_at));
    const full = after.some(
      (a) =>
        a.expected_qb_effect_cents !== undefined &&
        a.expected_qb_effect_cents !== 0 &&
        a.qb_object_id &&
        a.qb_object_coverage_confirmed &&
        a.sync_observation_complete &&
        qb.some(
          (q) =>
            q.transaction_id === a.qb_object_id && q.signed_cents !== a.expected_qb_effect_cents,
        ),
    );
    add(
      'POST_EXPORT_DRIFT',
      full ? 'CONFIRMED' : after.length ? 'SUPPORTED' : 'SUSPECTED',
      after.map((a) => a.evidence_ref),
      full
        ? []
        : ['EXPECTED_QB_OBJECT_AND_ACCOUNTING_EFFECT', 'QB_OBJECT_HISTORY_AND_SYNC_OBSERVATION'],
      after.length > 0,
      false,
    );
    group.warnings.push(
      after.length ? 'SOURCE_RELATIONSHIP_CHANGE' : 'POST_EXPORT_DRIFT_CANDIDATE',
    );
  }
  const external = ev.external_receipts.filter(
    (e) => refs.has(e.deposit_reference) && !e.entered_in_st,
  );
  if (external.length) {
    const confirmed =
      external.every((e) => e.independently_verified && e.business_nature === 'CUSTOMER_RECEIPT') &&
      stCovered &&
      bank.length > 0 &&
      group.external_receipts_cents === sumCents(external.map((e) => e.amount_cents));
    add(
      'OUT_OF_SYSTEM_DEPOSIT',
      confirmed ? 'CONFIRMED' : 'SUPPORTED',
      external.map((e) => e.evidence_ref),
      confirmed
        ? []
        : ['COMPLETE_ST_PAYMENT_COVERAGE', 'RECEIPT_BUSINESS_NATURE_AND_OWNER_VERIFICATION'],
      true,
      group.unexplained_cents === 0,
    );
  }
  if (!st.length && bank.some((b) => b.signed_cents > 0) && !external.length)
    group.warnings.push('UNATTRIBUTED_BANK_CREDIT', 'VERIFY_TRANSFER_LOAN_OR_CUSTOMER_RECEIPT');
  if (
    group.matching_state === 'BLOCKED' ||
    group.unexplained_cents !== 0 ||
    (!group.diagnoses.length &&
      group.matching_state !== 'MATCHED' &&
      group.matching_state !== 'PARTIAL')
  )
    add(
      'UNEXPLAINED',
      'UNKNOWN',
      [],
      group.matching_state === 'BLOCKED'
        ? ['INCOMPLETE_OR_INVALID_SOURCE']
        : ['UNRESOLVED_COMPONENT_OR_IDENTITY'],
      local.cashIdentity,
      false,
      false,
    );
  group.warnings = [...new Set(group.warnings)].sort();
}
