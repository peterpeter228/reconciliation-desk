import type { ST_Payment_Record } from '../contracts/canonical';
import type { EvidenceBundle } from '../contracts/engine';
import type { Normalized } from './normalize';
import { contentHash } from './identities';
import { sumCents } from './money';
import { isFinalSettlement } from './evidence';
export interface CashUnit {
  id: string;
  st: ST_Payment_Record[];
  gross: number;
  refunds: number;
  fees: number;
  holds: number;
  releases: number;
  net: number;
  evidence_refs: string[];
  payout_refs: string[];
  cash_evidenced: boolean;
  anchor: string;
  method: string;
  processor: string | null;
  merchant: string | null;
}
export function buildUnits(ctx: Normalized, evidence: Required<EvidenceBundle>): CashUnit[] {
  const grouped = new Map<string, ST_Payment_Record[]>();
  for (const r of ctx.st.filter((r) => r.record_type !== 'PAYMENT_CORRECTION')) {
    // An explicit accounting batch is a membership anchor, not a processor identity.
    const key = r.accounting_batch_id ? `batch:${r.accounting_batch_id}` : `payment:${r.id}`;
    const rows = grouped.get(key) ?? [];
    rows.push(r);
    grouped.set(key, rows);
  }
  const output: CashUnit[] = [];
  for (const rows of grouped.values()) {
    rows.sort((a, b) => a.id.localeCompare(b.id));
    const settlements = evidence.settlements.filter((e) =>
      rows.some((r) => r.source_payment_id === e.payment_id),
    );
    const components = evidence.deposit_components.filter(
      (e) => e.payment_id && rows.some((r) => r.source_payment_id === e.payment_id),
    );
    let fees = 0,
      holds = 0,
      releases = 0;
    const refs = new Set<string>();
    const payouts = new Set<string>();
    let all = true;
    for (const r of rows) {
      const s = settlements.find((e) => e.payment_id === r.source_payment_id);
      const cs = components.filter((e) => e.payment_id === r.source_payment_id);
      if (s && isFinalSettlement(s)) {
        fees = sumCents([fees, s.fee_cents ?? 0]);
        holds = sumCents([holds, s.held_cents]);
        releases = sumCents([releases, s.released_cents ?? 0]);
        refs.add(s.evidence_ref);
        if (s.settlement_reference) payouts.add(s.settlement_reference);
        if (s.fee_cents === null || s.net_cents === null) all = false;
      } else if (cs.length === 1) {
        const c = cs[0]!;
        fees = sumCents([fees, c.fee_cents]);
        refs.add(c.evidence_ref);
        payouts.add(c.deposit_reference);
      } else if (s) {
        // Forecast amounts and holds are not proof of completed cash movement.
        if (s.status === 'HELD') holds = sumCents([holds, s.held_cents]);
        refs.add(s.evidence_ref);
        if (s.settlement_reference) payouts.add(s.settlement_reference);
        all = false;
      } else if (r.deposit_id) {
        payouts.add(r.deposit_id);
        if (!['CHECK', 'CASH', 'ACH'].includes(r.payment_method) || r.fee_mode === 'NETTED')
          all = false;
      } else all = false;
      if (cs.length) {
        for (const c of cs) {
          refs.add(c.evidence_ref);
          payouts.add(c.deposit_reference);
        }
        if (
          s &&
          isFinalSettlement(s) &&
          cs.length === 1 &&
          (s.net_cents !== cs[0]!.net_cents || s.fee_cents !== cs[0]!.fee_cents)
        ) {
          ctx.blocked = true;
          ctx.warnings.push({
            code: 'EVIDENCE_COMPONENT_CONFLICT',
            message: 'Processor statement and deposit component disagree.',
            source_ids: [s.id, cs[0]!.id],
            severity: 'BLOCKING',
          });
        }
      }
    }
    const gross = sumCents(
        rows.filter((r) => r.record_type === 'PAYMENT').map((r) => r.gross_cents),
      ),
      refunds = sumCents(rows.filter((r) => r.record_type === 'REFUND').map((r) => -r.gross_cents));
    output.push({
      id: contentHash(rows.map((r) => r.id)),
      st: rows,
      gross,
      refunds,
      fees,
      holds,
      releases,
      net: sumCents([gross, -refunds, -fees, -holds, releases]),
      evidence_refs: [...refs].sort(),
      payout_refs: [...payouts].sort(),
      cash_evidenced: all,
      anchor: rows
        .map((r) => r.batch_close_date ?? r.payment_date)
        .sort()
        .at(-1)!,
      method:
        new Set(rows.map((r) => r.payment_method)).size === 1 ? rows[0]!.payment_method : 'MIXED',
      processor: new Set(rows.map((r) => r.processor)).size === 1 ? rows[0]!.processor : null,
      merchant: new Set(rows.map((r) => r.merchant_id)).size === 1 ? rows[0]!.merchant_id : null,
    });
  }
  return output.sort((a, b) => a.id.localeCompare(b.id));
}
