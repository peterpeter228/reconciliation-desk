import type {
  AllocationClaim,
  AtomControl,
  SourceControls,
  AccountControl,
  ReconcileInput,
} from '../contracts/engine';
import type { Normalized } from './normalize';
import { sumCents } from './money';
export function buildControls(
  input: ReconcileInput,
  ctx: Normalized,
  allocations: AllocationClaim[],
): SourceControls {
  const map = new Map<string, number>();
  for (const a of allocations)
    map.set(a.atom_id, sumCents([map.get(a.atom_id) ?? 0, a.signed_allocated_cents]));
  const atoms: AtomControl[] = [
    ...ctx.st.map((r) => ({ atom_id: r.id, source: 'ST' as const, source_cents: r.gross_cents })),
    ...ctx.qb.map((r) => ({ atom_id: r.id, source: 'QB' as const, source_cents: r.signed_cents })),
    ...ctx.bank.map((r) => ({
      atom_id: r.id,
      source: 'BANK' as const,
      source_cents: r.signed_cents,
    })),
  ].map((a) => ({
    ...a,
    allocated_cents: map.get(a.atom_id) ?? 0,
    residual_cents: a.source_cents - (map.get(a.atom_id) ?? 0),
    excluded_reason: null,
  }));
  const conservation_ok = atoms.every(
    (a) =>
      Math.abs(a.allocated_cents) <= Math.abs(a.source_cents) &&
      (a.allocated_cents === 0 || Math.sign(a.allocated_cents) === Math.sign(a.source_cents)) &&
      Number.isSafeInteger(a.residual_cents),
  );
  if (!conservation_ok) throw new Error('SOURCE_BUDGET_CONSERVATION_FAILED');
  const accounts: AccountControl[] = [];
  const accountNames = [...new Set(ctx.qb.map((r) => r.account_full_name))].sort();
  for (const name of accountNames) {
    const rows = ctx.qb.filter((r) => r.account_full_name === name);
    const id = rows[0]!.account_id ?? name;
    const debit = sumCents(rows.map((r) => r.debit_cents)),
      credit = sumCents(rows.map((r) => r.credit_cents));
    const candidates = input.manifests
      .filter((m) => ['QBO', 'QBD'].includes(m.source_system))
      .flatMap((m) => m.account_balances.filter((a) => a.account_full_name === name));
    const distinct = [...new Map(candidates.map((a) => [JSON.stringify(a), a])).values()];
    const meta = distinct.length === 1 ? distinct[0] : undefined;
    const opening = meta?.opening_debit_balance_cents ?? null,
      closing = meta?.closing_debit_balance_cents ?? null;
    const calculated = opening === null ? null : sumCents([opening, debit, -credit]);
    accounts.push({
      account_id: id,
      account_full_name: name,
      debit_cents: debit,
      credit_cents: credit,
      activity_cents: debit - credit,
      opening_cents: opening,
      closing_cents: closing,
      calculated_closing_cents: calculated,
      coverage_confirmed: meta?.coverage_confirmed ?? false,
      status:
        calculated !== null && closing !== null
          ? calculated === closing
            ? meta?.coverage_confirmed
              ? 'VERIFIED'
              : 'ACTIVITY_ONLY'
            : 'MISMATCH'
          : 'ACTIVITY_ONLY',
    });
  }
  return {
    st_gross_cents: sumCents(
      ctx.st.filter((r) => r.record_type === 'PAYMENT').map((r) => r.gross_cents),
    ),
    st_refunds_cents: sumCents(
      ctx.st.filter((r) => r.record_type === 'REFUND').map((r) => -r.gross_cents),
    ),
    st_corrections_cents: sumCents(
      ctx.st.filter((r) => r.record_type === 'PAYMENT_CORRECTION').map((r) => r.gross_cents),
    ),
    qb_debits_cents: sumCents(ctx.qb.map((r) => r.debit_cents)),
    qb_credits_cents: sumCents(ctx.qb.map((r) => r.credit_cents)),
    bank_signed_cents: sumCents(ctx.bank.map((r) => r.signed_cents)),
    accounts,
    atoms: [...atoms, ...ctx.excluded].sort((a, b) => a.atom_id.localeCompare(b.atom_id)),
    conservation_ok,
    coverage_confirmed: ['ST', 'BANK', 'QB'].every((source) =>
      input.manifests.some(
        (m) =>
          (source === 'QB'
            ? ['QBO', 'QBD'].includes(m.source_system)
            : m.source_system === source) && m.coverage_confirmed,
      ),
    ),
  };
}
