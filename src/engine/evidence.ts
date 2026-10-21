import type {
  EvidenceBase,
  EvidenceBundle,
  ReconcileInput,
  SettlementEvidence,
} from '../contracts/engine';
import type { Normalized } from './normalize';
import { assertCents } from './money';
import { validISODate } from './calendar';
import { stableJSON } from './identities';
/** Only terminal processor states can prove realized net cash and fees. */
export function isFinalSettlement(e: SettlementEvidence): boolean {
  return e.status === 'SETTLED' || e.status === 'REFUNDED';
}
export function validatedEvidence(
  input: ReconcileInput,
  ctx: Normalized,
): Required<EvidenceBundle> {
  const out: Required<EvidenceBundle> = {
    settlements: [],
    deposit_components: [],
    external_receipts: [],
    audit_events: [],
    confirmations: [],
  };
  for (const key of Object.keys(out) as (keyof EvidenceBundle)[]) {
    const seen = new Map<string, string>();
    for (const source of input.evidence?.[key] ?? []) {
      const e = source as unknown as EvidenceBase & Record<string, unknown>;
      try {
        if (
          !e.id ||
          e.company_id !== ctx.company ||
          e.currency !== 'USD' ||
          e.bank_account_id !== ctx.bankAccount
        )
          throw new Error('Evidence namespace conflict');
        if (!e.evidence_ref || !e.source_refs?.length)
          throw new Error('Evidence needs its actual imported source provenance');
        for (const p of e.source_refs) {
          if (
            !/^[a-f0-9]{64}$/i.test(p.file_sha256) ||
            !/^[a-f0-9]{64}$/i.test(p.raw_row_sha256) ||
            !Number.isInteger(p.physical_row) ||
            p.physical_row < 1 ||
            !p.parser_version ||
            !p.mapping_version ||
            !p.column_indices
          )
            throw new Error('Malformed evidence provenance');
        }
        const sourceManifests = input.manifests.filter((m) =>
          e.source_refs.some((p) => p.file_sha256 === m.source_file_sha256),
        );
        if (
          !sourceManifests.length ||
          e.source_refs.some(
            (p) => !sourceManifests.some((m) => m.source_file_sha256 === p.file_sha256),
          )
        )
          throw new Error('Evidence source file has not been imported in this run');
        const allowedSystems: Record<keyof EvidenceBundle, string[]> = {
          settlements: ['PROCESSOR'],
          deposit_components: ['RECEIPT'],
          external_receipts: ['RECEIPT'],
          audit_events: ['AUDIT'],
          confirmations: ['AUDIT', 'QBO', 'QBD'],
        };
        if (sourceManifests.some((m) => !allowedSystems[key].includes(m.source_system)))
          throw new Error(
            'Evidence file source family does not support the claimed independent evidence',
          );
        const observedThrough = sourceManifests
          .map((m) => m.as_of_date)
          .sort()
          .at(-1);
        if (e.as_of_date && observedThrough && String(e.as_of_date) > observedThrough)
          throw new Error('Evidence observation is later than its imported report scope');
        for (const name of ['actual_settlement_date', 'received_date', 'posted_date', 'event_at']) {
          const d = e[name];
          if (d && observedThrough && String(d).slice(0, 10) > observedThrough)
            throw new Error('Evidence event is later than its imported report scope');
        }
        for (const [name, value] of Object.entries(e)) {
          if (name.endsWith('_cents') && value !== null) assertCents(value, name);
          if (
            name.endsWith('_date') &&
            value !== null &&
            value !== undefined &&
            !validISODate(String(value))
          )
            throw new Error('Evidence date invalid');
        }
        if (key === 'settlements') {
          if (!['SETTLED', 'REFUNDED', 'HELD', 'PENDING', 'UNKNOWN'].includes(String(e.status)))
            throw new Error('Unknown settlement status');
          if (['PENDING', 'UNKNOWN'].includes(String(e.status)) && e.actual_settlement_date)
            throw new Error('Nonfinal settlement cannot claim an actual settlement date');
          if (e.actual_settlement_date && String(e.actual_settlement_date) > String(e.as_of_date))
            throw new Error('Actual settlement is later than its observation date');
          assertCents(e.gross_cents, 'Settlement gross');
          assertCents(e.held_cents, 'Settlement held');
          if (e.fee_cents !== null) assertCents(e.fee_cents, 'Settlement fee');
          if (e.net_cents !== null) assertCents(e.net_cents, 'Settlement net');
          const p = ctx.st.find((r) => r.source_payment_id === e.payment_id);
          if (!p) throw new Error('Settlement payment not present in this run');
          if (
            (e.status === 'REFUNDED' && p.record_type !== 'REFUND') ||
            (e.status === 'SETTLED' && p.record_type !== 'PAYMENT')
          )
            throw new Error('Final settlement status conflicts with its payment/refund type');

          if (
            p.deposit_id &&
            e.settlement_reference &&
            p.deposit_id !== e.settlement_reference &&
            !input.evidence?.deposit_components?.some(
              (c) =>
                c.payment_id === p.source_payment_id &&
                c.deposit_reference === p.deposit_id &&
                c.component_reference === e.settlement_reference,
            )
          )
            throw new Error(
              'Known ST deposit identity conflicts with settlement reference without an explicit component mapping',
            );
          if (p.processor && e.processor && p.processor !== e.processor)
            throw new Error('Processor conflict');
          if (p.merchant_id && e.merchant_id && p.merchant_id !== e.merchant_id)
            throw new Error('Merchant conflict');
          if (
            p.accounting_batch_id &&
            e.accounting_batch_id &&
            p.accounting_batch_id !== e.accounting_batch_id
          )
            throw new Error('Accounting batch conflict');
          if (
            p.processor_batch_id &&
            e.processor_batch_id &&
            p.processor_batch_id !== e.processor_batch_id
          )
            throw new Error('Processor batch conflict');
          if (e.gross_cents !== p.gross_cents)
            throw new Error('Settlement gross does not equal linked cash receipt/refund');
          if (
            Number(e.fee_cents) < 0 ||
            Number(e.held_cents) < 0 ||
            Number(e.released_cents ?? 0) < 0
          )
            throw new Error('Negative settlement component');
          if (Number(e.fee_cents) > 0 && e.fee_mode !== 'NETTED')
            throw new Error('Non-netted fee cannot reduce a settlement');
          if (
            e.fee_cents !== null &&
            e.net_cents !== null &&
            Number(e.gross_cents) -
              Number(e.fee_cents) -
              Number(e.held_cents) +
              Number(e.released_cents ?? 0) !==
              e.net_cents
          )
            throw new Error('Settlement equation does not conserve cents');
          if (
            ['SETTLED', 'REFUNDED'].includes(String(e.status)) &&
            (!e.settlement_reference || e.fee_cents === null || e.net_cents === null)
          )
            throw new Error('Settled cash requires reference and explicit component amounts');
        }
        if (key === 'deposit_components') {
          if (!e.deposit_reference || !e.component_reference)
            throw new Error('Component identities required');
          if (
            Number(e.gross_cents) - Number(e.fee_cents) !== e.net_cents ||
            Number(e.fee_cents) < 0
          )
            throw new Error('Deposit component equation does not conserve cents');
          if (Number(e.fee_cents) > 0 && (e.fee_mode !== 'NETTED' || !e.contract_reference))
            throw new Error('Net component fee needs netted contract evidence');
          if (e.payment_id) {
            const p = ctx.st.find((r) => r.source_payment_id === e.payment_id);
            if (!p || p.gross_cents !== e.gross_cents)
              throw new Error('Deposit member does not match receipt');
          }
        }
        if (key === 'confirmations') {
          if (!e.reviewer || !e.qb_transaction_id)
            throw new Error('Itemized confirmation requires reviewer and transaction');
          if (
            e.refund_payment_id !== undefined &&
            !ctx.st.some(
              (r) => r.record_type === 'REFUND' && r.source_payment_id === e.refund_payment_id,
            )
          )
            throw new Error('Refund confirmation must identify an imported refund payment');
        }
        const fingerprint = stableJSON(e);
        if (seen.has(e.id)) {
          if (seen.get(e.id) !== fingerprint)
            throw new Error('Evidence ID has conflicting versions');
          continue;
        }
        seen.set(e.id, fingerprint);
        // The array key and source discriminant were checked above; no free-text instruction is interpreted.
        (out[key] as EvidenceBase[]).push(structuredClone(source));
      } catch (err) {
        ctx.warnings.push({
          code: 'INVALID_EVIDENCE',
          message: err instanceof Error ? err.message : 'Invalid evidence',
          source_ids: [e.id],
          severity: 'BLOCKING',
        });
        ctx.blocked = true;
      }
    }
  }
  for (const key of Object.keys(out) as (keyof EvidenceBundle)[])
    out[key].sort((a, b) => a.id.localeCompare(b.id));
  // Two settlement statements consuming the same payment require an explicit split adapter.
  const seenPayments = new Set<string>();
  for (const e of out.settlements) {
    if (seenPayments.has(e.payment_id)) {
      ctx.blocked = true;
      ctx.warnings.push({
        code: 'UNSUPPORTED_SPLIT_SETTLEMENT',
        message:
          'Multiple settlement statements for one payment require documented disjoint allocations.',
        source_ids: [e.id],
        severity: 'BLOCKING',
      });
    }
    seenPayments.add(e.payment_id);
  }
  const confirmations = new Map<string, (typeof out.confirmations)[number]>();
  for (const c of out.confirmations) {
    const key = JSON.stringify([c.deposit_reference, c.qb_transaction_id]);
    const prior = confirmations.get(key);
    if (
      prior &&
      (prior.bank_effect_cents !== c.bank_effect_cents ||
        prior.clearing_account_id !== c.clearing_account_id ||
        prior.fee_account_name !== c.fee_account_name ||
        prior.period_open !== c.period_open ||
        (prior.expense_coverage_confirmed &&
          c.expense_coverage_confirmed &&
          prior.fee_not_recorded !== c.fee_not_recorded))
    ) {
      ctx.blocked = true;
      ctx.warnings.push({
        code: 'CONTRADICTORY_ACCOUNTING_CONFIRMATIONS',
        message:
          'Itemized accounting confirmations conflict; select and verify the current evidence before preparing a draft.',
        source_ids: [prior.id, c.id],
        severity: 'BLOCKING',
      });
    }
    confirmations.set(key, c);
  }
  const refundConfirmations = new Map<string, (typeof out.confirmations)[number]>();
  for (const c of out.confirmations) {
    if (!c.refund_payment_id || !c.refund_coverage_confirmed) continue;
    const key = JSON.stringify([c.deposit_reference, c.qb_transaction_id, c.refund_payment_id]);
    const prior = refundConfirmations.get(key);
    if (prior && prior.refund_not_recorded !== c.refund_not_recorded) {
      ctx.blocked = true;
      ctx.warnings.push({
        code: 'CONTRADICTORY_ACCOUNTING_CONFIRMATIONS',
        message: 'Itemized refund accounting confirmations conflict.',
        source_ids: [prior.id, c.id],
        severity: 'BLOCKING',
      });
    }
    refundConfirmations.set(key, c);
  }
  return out;
}
