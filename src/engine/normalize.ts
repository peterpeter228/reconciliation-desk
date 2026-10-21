import type {
  Bank_Deposit_Row,
  BaseRecord,
  QB_Ledger_Entry,
  ST_Payment_Record,
} from '../contracts/canonical';
import type { AtomControl, EngineWarning, ReconcileInput } from '../contracts/engine';
import { validISODate } from './calendar';
import { stableJSON, typedIdentity } from './identities';
import { assertCents, sumCents } from './money';
export interface Normalized {
  st: ST_Payment_Record[];
  qb: QB_Ledger_Entry[];
  bank: Bank_Deposit_Row[];
  company: string;
  bankAccount: string;
  warnings: EngineWarning[];
  excluded: AtomControl[];
  blocked: boolean;
}
function economicJSON(row: BaseRecord): string {
  const copy = { ...row } as Record<string, unknown>;
  for (const k of ['id', 'source_refs', 'validation_errors']) delete copy[k];
  return stableJSON(copy);
}
export function normalize(input: ReconcileInput): Normalized {
  const warnings: EngineWarning[] = [];
  const excluded: AtomControl[] = [];
  const warn = (
    code: string,
    message: string,
    source_ids: string[] = [],
    severity: EngineWarning['severity'] = 'WARNING',
  ) => warnings.push({ code, message, source_ids, severity });
  const companies = new Set([...input.st, ...input.qb, ...input.bank].map((r) => r.company_id));
  const accounts = new Set(input.bank.map((r) => r.bank_account_id));
  const company = input.config?.company_id ?? (companies.size === 1 ? [...companies][0]! : '');
  const bankAccount =
    input.config?.bank_account_id ?? (accounts.size === 1 ? [...accounts][0]! : '');
  if (!company)
    warn('COMPANY_REQUIRED', 'Exactly one explicit company is required.', [], 'BLOCKING');
  if (!bankAccount)
    warn('BANK_ACCOUNT_REQUIRED', 'Exactly one selected bank account is required.', [], 'BLOCKING');
  for (const m of input.manifests) {
    if (m.company_id !== company)
      warn(
        'MANIFEST_COMPANY_CONFLICT',
        'Import manifest belongs to another company.',
        [],
        'BLOCKING',
      );
    if (
      !validISODate(m.period_start) ||
      !validISODate(m.period_end) ||
      !validISODate(m.as_of_date) ||
      m.period_start > m.period_end
    )
      warn('MANIFEST_DATE_INVALID', 'Manifest dates are invalid.', [], 'BLOCKING');
    if (m.missing_required_fields.length)
      warn('MANIFEST_REQUIRED_FIELDS', m.missing_required_fields.join(', '), [], 'BLOCKING');
  }
  function process<T extends BaseRecord>(
    rows: T[],
    source: 'ST' | 'QB' | 'BANK',
    amount: (row: T) => number,
    identity: (row: T) => string | null,
    validate: (row: T) => void,
  ): T[] {
    const ids = new Map<string, T>();
    const keys = new Map<string, T>();
    for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
      let n = 0;
      try {
        n = amount(row);
        assertCents(n);
        if (!row.id || !row.company_id) throw new Error('Missing canonical ID/company');
        if (row.company_id !== company) throw new Error('COMPANY_CONFLICT');
        if (row.currency !== 'USD') throw new Error('CURRENCY_CONFLICT');
        if (row.validation_errors.length) throw new Error(row.validation_errors.join('; '));
        if (!row.source_refs.length) throw new Error('PROVENANCE_REQUIRED');
        for (const p of row.source_refs) {
          if (
            !p.file_sha256 ||
            !p.raw_row_sha256 ||
            !Number.isInteger(p.physical_row) ||
            p.physical_row < 1
          )
            throw new Error('PROVENANCE_INVALID');
        }
        validate(row);
      } catch (e) {
        warn(
          'INVALID_SOURCE',
          e instanceof Error ? e.message : 'Invalid source',
          [row.id],
          'BLOCKING',
        );
        excluded.push({
          atom_id: row.id,
          source,
          source_cents: Number.isSafeInteger(n) ? n : 0,
          allocated_cents: 0,
          residual_cents: Number.isSafeInteger(n) ? n : 0,
          excluded_reason: 'INVALID_SOURCE',
        });
        continue;
      }
      const existingId = ids.get(row.id);
      const key = identity(row);
      const prior = existingId ?? (key ? keys.get(key) : undefined);
      if (prior) {
        let same = economicJSON(prior) === economicJSON(row);
        if (
          source === 'ST' &&
          (row as unknown as ST_Payment_Record).row_grain === 'PAYMENT_APPLICATION'
        ) {
          const p = prior as unknown as ST_Payment_Record,
            r = row as unknown as ST_Payment_Record;
          const strip = (v: ST_Payment_Record) => {
            const copy = { ...v, invoice_allocations: [], row_grain: 'PAYMENT_APPLICATION' };
            return economicJSON(copy);
          };
          same = strip(p) === strip(r);
          if (same) {
            const allocations = new Map(
              [...p.invoice_allocations, ...r.invoice_allocations].map((a) => [stableJSON(a), a]),
            );
            p.invoice_allocations = [...allocations.values()].sort((a, b) =>
              a.invoice_id.localeCompare(b.invoice_id),
            );
            const applied = sumCents(p.invoice_allocations.map((a) => a.applied_cents ?? 0));
            if (applied > Math.abs(p.gross_cents))
              warn(
                'APPLICATION_OVERALLOCATED',
                'Invoice applications exceed the original receipt.',
                [p.id, row.id],
                'BLOCKING',
              );
          }
        }
        if (!same) {
          warn(
            'SOURCE_ID_VERSION_CONFLICT',
            'A reliable source ID has conflicting versions; choose a current version before matching.',
            [prior.id, row.id],
            'BLOCKING',
          );
          if (!existingId) ids.set(row.id, structuredClone(row));
        } else {
          prior.source_refs = [
            ...new Map(
              [...prior.source_refs, ...row.source_refs].map((p) => [stableJSON(p), p]),
            ).values(),
          ];
          warn(
            'DUPLICATE_SOURCE_MERGED',
            'Identical reliable source record merged without consuming its amount twice.',
            [prior.id, row.id],
            'INFO',
          );
        }
        continue;
      }
      const clone = structuredClone(row);
      ids.set(row.id, clone);
      if (key) keys.set(key, clone);
    }
    return [...ids.values()];
  }
  let st = process(
    input.st,
    'ST',
    (r) => r.gross_cents,
    (r) =>
      r.source_payment_id
        ? typedIdentity(r.company_id, 'ST', 'payment', r.source_payment_id)
        : null,
    (r) => {
      if (!validISODate(r.payment_date)) throw new Error('INVALID_PAYMENT_DATE');
      if (r.bank_account_id && r.bank_account_id !== bankAccount)
        throw new Error('BANK_ACCOUNT_CONFLICT');
      if (r.record_type === 'PAYMENT' && r.gross_cents < 0)
        throw new Error('NEGATIVE_PAYMENT_REQUIRES_REFUND_TYPE');
      if (r.record_type === 'REFUND' && r.gross_cents > 0)
        throw new Error('REFUND_MUST_BE_NONPOSITIVE');
      if (r.row_grain === 'PAYMENT_APPLICATION' && !r.source_payment_id)
        throw new Error('PAYMENT_APPLICATION_ID_REQUIRED');
      for (const n of [
        r.reported_net_cents,
        r.reported_fee_cents,
        ...r.invoice_allocations.map((a) => a.applied_cents),
      ])
        if (n !== null) assertCents(n);
    },
  );
  let qb = process(
    input.qb,
    'QB',
    (r) => r.signed_cents,
    (r) =>
      r.transaction_id && r.line_id
        ? typedIdentity(
            r.company_id,
            r.qb_product,
            `account:${r.account_id ?? r.account_full_name}:posting`,
            JSON.stringify([r.transaction_id, r.line_id]),
          )
        : null,
    (r) => {
      for (const n of [r.debit_cents, r.credit_cents]) assertCents(n);
      if (
        r.debit_cents < 0 ||
        r.credit_cents < 0 ||
        (r.debit_cents > 0 && r.credit_cents > 0) ||
        r.signed_cents !== r.debit_cents - r.credit_cents
      )
        throw new Error('INVALID_DEBIT_CREDIT');
      if (!validISODate(r.posting_date)) throw new Error('INVALID_POSTING_DATE');
    },
  );
  let bank = process(
    input.bank,
    'BANK',
    (r) => r.signed_cents,
    (r) =>
      r.source_transaction_id
        ? typedIdentity(
            r.company_id,
            'BANK',
            `account:${r.bank_account_id}:transaction`,
            r.source_transaction_id,
          )
        : null,
    (r) => {
      if (!validISODate(r.posted_date)) throw new Error('INVALID_BANK_DATE');
      if (r.bank_account_id !== bankAccount) throw new Error('BANK_ACCOUNT_CONFLICT');
    },
  );
  function remove<T extends BaseRecord>(
    rows: T[],
    source: 'ST' | 'QB' | 'BANK',
    amount: (r: T) => number,
    reason: (r: T) => string | null,
  ): T[] {
    return rows.filter((r) => {
      const why = reason(r);
      if (!why) return true;
      const n = amount(r);
      excluded.push({
        atom_id: r.id,
        source,
        source_cents: n,
        allocated_cents: 0,
        residual_cents: n,
        excluded_reason: why,
      });
      warn(why, 'Record retained for review but excluded from eligible cash/posting atoms.', [
        r.id,
      ]);
      return false;
    });
  }
  const globalIds = [...st, ...qb, ...bank].map((r) => r.id);
  if (new Set(globalIds).size !== globalIds.length)
    warn(
      'CROSS_SYSTEM_CANONICAL_ID_COLLISION',
      'Canonical IDs must be globally namespaced across source systems.',
      [],
      'BLOCKING',
    );
  for (const summary of st.filter(
    (r) => r.row_grain === 'BATCH_SUMMARY' && r.accounting_batch_id,
  )) {
    const members = st.filter(
      (r) =>
        r.row_grain !== 'BATCH_SUMMARY' &&
        r.accounting_batch_id === summary.accounting_batch_id &&
        r.record_type === summary.record_type,
    );
    if (members.length && sumCents(members.map((r) => r.gross_cents)) !== summary.gross_cents)
      warn(
        'SUMMARY_DETAIL_CONTROL_MISMATCH',
        'ST batch summary does not equal supplied member detail.',
        [summary.id, ...members.map((r) => r.id)],
        'BLOCKING',
      );
  }
  for (const summary of qb.filter(
    (r) => r.line_grain === 'TRANSACTION_SUMMARY' && r.transaction_id,
  )) {
    const members = qb.filter(
      (r) =>
        r.line_grain === 'POSTING_LINE' &&
        r.transaction_id === summary.transaction_id &&
        r.account_full_name === summary.account_full_name,
    );
    if (members.length && sumCents(members.map((r) => r.signed_cents)) !== summary.signed_cents)
      warn(
        'SUMMARY_DETAIL_CONTROL_MISMATCH',
        'QB account summary does not equal supplied posting detail.',
        [summary.id, ...members.map((r) => r.id)],
        'BLOCKING',
      );
  }
  const stBatches = new Set(
    st
      .filter((r) => r.row_grain !== 'BATCH_SUMMARY')
      .map((r) => r.accounting_batch_id)
      .filter(Boolean),
  );
  st = remove(
    st,
    'ST',
    (r) => r.gross_cents,
    (r) =>
      r.row_grain === 'BATCH_SUMMARY' && stBatches.has(r.accounting_batch_id)
        ? 'SUMMARY_DETAIL_EXCLUDED'
        : r.record_type !== 'PAYMENT_CORRECTION' && r.payment_status !== 'SUCCESS'
          ? 'UNSUCCESSFUL_PAYMENT_EXCLUDED'
          : null,
  );
  const detailTx = new Set(
    qb
      .filter((r) => r.line_grain === 'POSTING_LINE')
      .map((r) => r.transaction_id)
      .filter(Boolean),
  );
  qb = remove(
    qb,
    'QB',
    (r) => r.signed_cents,
    (r) =>
      !r.is_posted_ledger
        ? 'BANK_FEED_REVIEW_IS_NOT_LEDGER'
        : r.line_grain === 'TRANSACTION_SUMMARY'
          ? detailTx.has(r.transaction_id)
            ? 'SUMMARY_DETAIL_EXCLUDED'
            : 'SUMMARY_WITHOUT_POSTING_LINES'
          : null,
  );
  bank = remove(
    bank,
    'BANK',
    (r) => r.signed_cents,
    (r) => (r.pending ? 'PENDING_BANK_EXCLUDED' : null),
  );
  return {
    st,
    qb,
    bank,
    company,
    bankAccount,
    warnings,
    excluded,
    blocked: warnings.some((w) => w.severity === 'BLOCKING'),
  };
}
