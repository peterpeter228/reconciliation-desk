import { z } from 'zod';
import type {
  Provenance,
  ST_Payment_Record,
  QB_Ledger_Entry,
  Bank_Deposit_Row,
} from '../../contracts/canonical';
import type {
  AuditEvidence,
  DepositComponentEvidence,
  ExternalReceiptEvidence,
  SettlementEvidence,
} from '../contracts/engine';
import type { ColumnBindings, ParseOptions, SourceKind } from './types';
import {
  bool,
  canonicalJson,
  checkedSum,
  MAX_CENTS,
  parseDate,
  parseMoney,
  sha256,
  timestamp,
  upper,
} from './primitives';
export interface RowByKind {
  ST: ST_Payment_Record;
  QBO: QB_Ledger_Entry;
  QBD: QB_Ledger_Entry;
  BANK: Bank_Deposit_Row;
  PROCESSOR: SettlementEvidence;
  AUDIT: AuditEvidence;
  RECEIPT: ExternalReceiptEvidence;
  COMPONENT: DepositComponentEvidence;
}
export type AnyRow = RowByKind[SourceKind];
const cents = z.number().int().min(-MAX_CENTS).max(MAX_CENTS).refine(Number.isSafeInteger);
const baseSchema = z
  .object({
    id: z.string().min(1),
    company_id: z.string().min(1),
    currency: z.literal('USD'),
    source_refs: z
      .array(
        z
          .object({
            file_sha256: z.string().regex(/^[0-9a-f]{64}$/),
            physical_row: z.number().int().positive(),
            raw_row_sha256: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();
const nonnegative = cents.refine((n) => n >= 0);
const schemas = {
  ST: baseSchema.extend({
    gross_cents: cents,
    reported_net_cents: cents.nullable(),
    reported_fee_cents: nonnegative.nullable(),
    payment_date: z.string(),
    row_grain: z.enum(['PAYMENT', 'PAYMENT_APPLICATION', 'BATCH_SUMMARY']),
  }),
  QBO: baseSchema
    .extend({
      debit_cents: nonnegative,
      credit_cents: nonnegative,
      signed_cents: cents,
      account_full_name: z.string().min(1),
      is_posted_ledger: z.boolean(),
    })
    .refine(
      (r) =>
        r.signed_cents === r.debit_cents - r.credit_cents &&
        !(r.debit_cents > 0 && r.credit_cents > 0),
      'Invalid debit/credit legs',
    ),
  BANK: baseSchema.extend({
    bank_account_id: z.string().min(1),
    signed_cents: cents,
    pending: z.boolean(),
    balance_cents: cents.nullable(),
  }),
  PROCESSOR: baseSchema.extend({
    gross_cents: cents,
    fee_cents: nonnegative.nullable(),
    net_cents: cents.nullable(),
    held_cents: nonnegative,
    evidence_ref: z.string().min(1),
    payment_id: z.string().min(1),
    settlement_reference: z.string().nullable(),
  }),
  AUDIT: baseSchema.extend({
    original_receipt_cents: cents,
    correction_cents: cents,
    evidence_ref: z.string().min(1),
  }),
  RECEIPT: baseSchema.extend({
    amount_cents: cents,
    entered_in_st: z.boolean(),
    evidence_ref: z.string().min(1),
  }),
  COMPONENT: baseSchema.extend({
    gross_cents: cents,
    fee_cents: nonnegative,
    net_cents: cents,
    bank_amount_cents: cents,
    evidence_ref: z.string().min(1),
  }),
};
function enumValue<T extends string>(
  raw: string,
  choices: readonly T[],
  fallback: T,
  aliases: Record<string, T> = {},
): T {
  const value = upper(raw);
  if (!value) return fallback;
  if (value in aliases) return aliases[value];
  if (choices.includes(value as T)) return value as T;
  throw new Error(`Unsupported enum value for ${choices.join('/')}.`);
}
const feeModes = ['NETTED', 'SEPARATE_INVOICE', 'GROSS_SETTLED', 'UNKNOWN'] as const;
const methods = ['CARD', 'CHECK', 'CASH', 'ACH', 'FINANCING', 'OTHER', 'UNKNOWN'] as const;
/** Allowlisted, bounded typed references only. Never fuzzy-substring IDs. */
export function extractDepositRef(s: string): string | null {
  const refs = s.match(/\b(?:SET|FUND|CONSOL|DEP)\d{5,}\b/g) ?? [];
  return new Set(refs).size === 1 ? (refs[0] ?? null) : null;
}
export async function normalizeRow<K extends SourceKind>(
  raw: string[],
  kind: K,
  b: ColumnBindings,
  o: ParseOptions,
  provenance: Provenance,
): Promise<RowByKind[K]> {
  const get = (key: string) => (b[key] === undefined ? '' : (raw[b[key]] ?? '').trim());
  const text = (key: string) => get(key) || null;
  const money = (key: string, nullable = false) => parseMoney(get(key), nullable);
  const date = (key: string, nullable = false) =>
    parseDate(get(key), o.dateFormat ?? 'MDY', nullable);
  if (get('company_id') && get('company_id') !== o.companyId)
    throw new Error('Cross-company row is forbidden.');
  if (get('currency') && get('currency') !== 'USD') throw new Error('Only USD is supported.');
  if (get('bank_account_id') && get('bank_account_id') !== o.bankAccountId)
    throw new Error('Row bank account conflicts with selected bank account.');
  const synthetic = o.profile === 'synthetic-v1';
  const base = {
    id: '',
    company_id: o.companyId,
    currency: 'USD' as const,
    source_refs: [provenance],
    validation_errors: [] as string[],
  };
  const token = async (key: string) =>
    get(key) ? `LOCAL_${(await sha256(`${o.companyId}:${get(key)}`)).slice(0, 20)}` : null;
  let row: AnyRow;
  if (kind === 'ST') {
    const grain = enumValue(
      get('row_grain'),
      ['PAYMENT', 'PAYMENT_APPLICATION', 'BATCH_SUMMARY'] as const,
      o.rowGrain ?? (b.applied_cents !== undefined ? 'PAYMENT_APPLICATION' : 'PAYMENT'),
    );
    if (!text('source_payment_id') && grain !== 'BATCH_SUMMARY')
      throw new Error(
        'Payment ID required; without it use a confirmed batch-summary report, not fabricated identities.',
      );
    if (grain === 'BATCH_SUMMARY' && !text('accounting_batch_id'))
      throw new Error('Batch summary requires an accounting batch ID.');
    if (
      grain === 'PAYMENT_APPLICATION' &&
      (!text('invoice_id') || money('applied_cents', true) === null)
    )
      throw new Error('Payment application rows require Invoice ID and explicit applied amount.');
    const recordType = enumValue(
      get('record_type'),
      ['PAYMENT', 'REFUND', 'PAYMENT_CORRECTION'] as const,
      'PAYMENT',
    );
    const gross = money('gross_cents')!;
    if ((recordType === 'REFUND' && gross >= 0) || (recordType === 'PAYMENT' && gross < 0))
      throw new Error('Payment/refund sign conflicts with record type.');
    row = {
      ...base,
      source_payment_id: text('source_payment_id'),
      record_type: recordType,
      row_grain: grain,
      original_payment_id: text('original_payment_id'),
      invoice_allocations: text('invoice_id')
        ? [{ invoice_id: get('invoice_id'), applied_cents: money('applied_cents', true) }]
        : [],
      accounting_batch_id: text('accounting_batch_id'),
      processor_batch_id: text('processor_batch_id'),
      deposit_id: text('deposit_id'),
      payment_date: date('payment_date')!,
      batch_close_date: date('batch_close_date', true),
      batch_post_date: date('batch_post_date', true),
      export_at: timestamp(get('export_at'), true),
      expected_settlement_date: date('expected_settlement_date', true),
      export_status: enumValue(
        get('export_status'),
        ['PENDING', 'POSTED', 'EXPORTED', 'FAILED', 'UNKNOWN'] as const,
        'UNKNOWN',
        { NOT_EXPORTED: 'PENDING' },
      ),
      export_status_basis: enumValue(
        get('export_status_basis'),
        ['SYSTEM', 'MANUALLY_MARKED', 'UNKNOWN'] as const,
        synthetic ? 'SYSTEM' : 'UNKNOWN',
      ),
      export_mode: enumValue(
        get('export_mode'),
        ['PAYMENT_TO_UF', 'JE_TO_CLEARING', 'FINANCE_WORKFLOW', 'UNKNOWN'] as const,
        o.exportMode ?? (synthetic ? 'JE_TO_CLEARING' : 'UNKNOWN'),
      ),
      customer_token: await token('customer'),
      business_unit: text('business_unit'),
      payment_method: enumValue(get('payment_method'), methods, 'UNKNOWN', {
        CREDIT_CARD: 'CARD',
        CREDITCARD: 'CARD',
        BANK_TRANSFER: 'ACH',
        FINANCE: 'FINANCING',
        GREENSKY: 'FINANCING',
        VISA: 'CARD',
        MASTERCARD: 'CARD',
        AMEX: 'CARD',
        DISCOVER: 'CARD',
        ADJUSTMENT: 'OTHER',
      }),
      card_brand: text('card_brand'),
      processor: text('processor'),
      merchant_id: text('merchant_id'),
      bank_account_id: o.bankAccountId,
      gross_cents: gross,
      reported_net_cents: money('reported_net_cents', true),
      reported_fee_cents: money('reported_fee_cents', true),
      fee_mode: enumValue(
        get('fee_mode'),
        feeModes,
        'UNKNOWN',
        synthetic ? { NONE: 'GROSS_SETTLED' } : {},
      ),
      reference: text('reference'),
      gl_account_code: text('gl_account_code'),
      payment_status: enumValue(
        get('payment_status'),
        ['SUCCESS', 'PENDING', 'FAILED', 'VOID', 'UNKNOWN'] as const,
        'UNKNOWN',
        {
          COMPLETED: 'SUCCESS',
          SUCCEEDED: 'SUCCESS',
          VOIDED: 'VOID',
          REFUNDED: 'SUCCESS',
          APPLICATION_ADJUSTED: 'UNKNOWN',
        },
      ),
    };
  } else if (kind === 'QBO' || kind === 'QBD') {
    if (!get('debit_cents') && !get('credit_cents'))
      throw new Error(
        'Both debit and credit are blank; an unknown ledger amount cannot become zero.',
      );
    const debit = money('debit_cents', true) ?? 0,
      credit = money('credit_cents', true) ?? 0,
      signed = debit - credit;
    if (get('signed_cents') && money('signed_cents') !== signed)
      throw new Error('Reported Amount conflicts with Debit minus Credit.');
    const account = get('account_full_name');
    const mapping =
      o.accountMap?.[account] ??
      (synthetic && account === 'ServiceTitan Clearing'
        ? { accountType: 'OTHER_CURRENT_ASSET' as const, role: 'CLEARING' as const }
        : undefined);
    const accountType = enumValue(
      get('account_type'),
      [
        'BANK',
        'OTHER_CURRENT_ASSET',
        'OTHER_CURRENT_LIABILITY',
        'EXPENSE',
        'OTHER',
        'UNKNOWN',
      ] as const,
      mapping?.accountType ?? 'UNKNOWN',
    );
    const num = text('num'),
      txType = get('transaction_type') || 'UNKNOWN',
      memo = text('memo_local'),
      split = get('split_account') === '-Split-' ? null : text('split_account');
    const postedValue = bool(get('is_posted_ledger'));
    if (postedValue === null && !synthetic && o.postedLedgerConfirmed === undefined)
      throw new Error(
        'Confirm this is a posted General Ledger, not Bank Feed or an unposted transaction report.',
      );
    let role: QB_Ledger_Entry['role'] =
      mapping?.role === 'BANK'
        ? 'BANK'
        : mapping?.role === 'FEE'
          ? 'FEE'
          : mapping?.role === 'CLEARING'
            ? signed > 0
              ? 'CLEARING_RECEIPT'
              : 'CLEARING_SETTLEMENT'
            : 'UNKNOWN';
    if (synthetic && num?.startsWith('FEE')) role = 'FEE';
    role = enumValue(
      get('role'),
      ['CLEARING_RECEIPT', 'CLEARING_SETTLEMENT', 'FEE', 'BANK', 'OTHER', 'UNKNOWN'] as const,
      role,
    );
    row = {
      ...base,
      qb_product: kind,
      transaction_id: text('transaction_id'),
      line_id: text('line_id'),
      transaction_type: txType,
      posting_date: date('posting_date')!,
      num,
      name_token: await token('name'),
      memo_local: memo,
      account_id: text('account_id'),
      account_full_name: account,
      account_type: accountType,
      split_account: split,
      debit_cents: debit,
      credit_cents: credit,
      signed_cents: signed,
      running_balance_cents: money('running_balance_cents', true),
      cleared_status: enumValue(
        get('cleared_status'),
        ['UNCLEARED', 'CLEARED', 'RECONCILED', 'UNKNOWN'] as const,
        'UNKNOWN',
        { C: 'CLEARED', R: 'RECONCILED', '*': 'CLEARED' },
      ),
      role,
      line_grain: enumValue(
        get('line_grain'),
        ['POSTING_LINE', 'TRANSACTION_SUMMARY'] as const,
        'POSTING_LINE',
      ),
      linked_payment_id: text('linked_payment_id'),
      linked_deposit_id:
        text('linked_deposit_id') ??
        (synthetic ? extractDepositRef(`${num ?? ''} ${memo ?? ''}`) : null),
      accounting_batch_id:
        text('accounting_batch_id') ??
        (synthetic && num && /^(?:FEE)?\d+$/.test(num) ? num.replace(/^FEE/, '') : null),
      is_posted_ledger: postedValue ?? o.postedLedgerConfirmed ?? synthetic,
      class_name: text('class_name'),
      location_name: text('location_name'),
    };
  } else if (kind === 'BANK') {
    if (!synthetic && o.bankSignConvention !== 'INFLOW_POSITIVE')
      throw new Error('Confirm bank signs: credits/inflows positive, debits/outflows negative.');
    const bankAmount = money('signed_cents')!;
    if (
      (upper(get('details')) === 'CREDIT' && bankAmount < 0) ||
      (upper(get('details')) === 'DEBIT' && bankAmount > 0)
    )
      throw new Error('Bank Details direction conflicts with the signed amount.');
    let pending = bool(get('pending'));
    if (get('status'))
      pending = enumValue(get('status'), ['PENDING', 'POSTED'] as const, 'PENDING') === 'PENDING';
    if (pending === null && !synthetic && o.bankPostedConfirmed !== true)
      throw new Error(
        'Confirm the bank file contains posted transactions, or map an explicit posting status.',
      );
    const description = get('description_local');
    row = {
      ...base,
      bank_name: o.bankName ?? (synthetic ? 'Synthetic Chase-style' : 'User supplied bank'),
      bank_account_id: o.bankAccountId,
      source_transaction_id: text('source_transaction_id'),
      posted_date: date('posted_date')!,
      value_date: date('value_date', true),
      pending: pending ?? false,
      signed_cents: bankAmount,
      description_local: description,
      descriptor_tokens:
        description.match(
          /\b(?:TSYS|GREENSKY|ACH|CHECK|ST PAYMENTS|SET\d+|FUND\d+|CONSOL\d+|DEP\d+)\b/gi,
        ) ?? [],
      bank_type: enumValue(
        get('bank_type'),
        [
          'ACH_CREDIT',
          'MERCHANT_DEPOSIT',
          'CHECK_DEPOSIT',
          'CASH_DEPOSIT',
          'SWEEP',
          'DEBIT',
          'OTHER',
          'UNKNOWN',
        ] as const,
        'UNKNOWN',
        { DEPOSIT: 'MERCHANT_DEPOSIT', CHECK: 'CHECK_DEPOSIT', ACH_DEBIT: 'DEBIT' },
      ),
      check_number: text('check_number'),
      trace_id: text('trace_id'),
      deposit_id: text('deposit_id') ?? (synthetic ? extractDepositRef(description) : null),
      balance_cents: money('balance_cents', true),
      granularity: enumValue(
        get('granularity'),
        ['TRANSACTION', 'DAILY_SUMMARY'] as const,
        'TRANSACTION',
      ),
    };
  } else {
    const ev = {
      ...base,
      bank_account_id: o.bankAccountId,
      evidence_ref: get('evidence_document'),
    };
    if (kind === 'PROCESSOR')
      row = {
        ...ev,
        id: get('id'),
        payment_id: get('payment_id'),
        accounting_batch_id: text('accounting_batch_id'),
        processor_batch_id: text('processor_batch_id'),
        settlement_reference: text('settlement_reference'),
        processor: text('processor'),
        merchant_id: null,
        status: enumValue(
          get('status'),
          ['SETTLED', 'HELD', 'PENDING', 'REFUNDED', 'UNKNOWN'] as const,
          'UNKNOWN',
          { REFUND_SETTLED: 'REFUNDED' },
        ),
        gross_cents: money('gross_cents')!,
        fee_cents: money('fee_cents', true),
        net_cents: money('net_cents', true),
        held_cents: money('held_cents')!,
        fee_mode: enumValue(
          get('fee_mode'),
          feeModes,
          'UNKNOWN',
          synthetic ? { NONE: 'GROSS_SETTLED' } : {},
        ),
        as_of_date: date('as_of_date')!,
        scheduled_settlement_date: date('scheduled_settlement_date', true),
        actual_settlement_date: date('actual_settlement_date', true),
        contract_reference: text('contract_reference'),
        release_coverage_confirmed: false,
      };
    else if (kind === 'AUDIT')
      row = {
        ...ev,
        id: get('id'),
        original_payment_id: get('original_payment_id'),
        correction_payment_id: text('correction_payment_id'),
        original_exported_at: timestamp(get('original_exported_at'))!,
        event_at: timestamp(get('event_at'))!,
        action: get('action'),
        original_receipt_cents: money('original_receipt_cents')!,
        correction_cents: money('correction_cents')!,
        cash_refund_confirmed: bool(get('cash_refund_confirmed')) ?? false,
      };
    else if (kind === 'RECEIPT') {
      const entered = bool(get('entered_in_st'));
      if (entered === null) throw new Error('Receipt ST entry status is unknown.');
      row = {
        ...ev,
        id: get('id'),
        receipt_id: get('id'),
        deposit_reference: get('deposit_reference'),
        received_date: date('received_date')!,
        amount_cents: money('amount_cents')!,
        entered_in_st: entered,
        business_nature: synthetic ? 'CUSTOMER_RECEIPT' : 'UNKNOWN',
        independently_verified: synthetic,
        check_number: text('check_number'),
      };
    } else
      row = {
        ...ev,
        id: get('component_reference'),
        deposit_reference: get('deposit_reference'),
        component_reference: get('component_reference'),
        payment_id: text('st_payment_id'),
        component_type: enumValue(
          get('component_type'),
          ['NETTED_FINANCING', 'ST_CHECK', 'OFFICE_CHECK', 'OTHER'] as const,
          'OTHER',
        ),
        gross_cents: money('gross_cents')!,
        fee_cents: money('fee_cents')!,
        net_cents: money('net_cents')!,
        bank_amount_cents: money('bank_amount_cents')!,
        posted_date: date('bank_posting_date')!,
        fee_mode: enumValue(
          get('fee_mode'),
          feeModes,
          'UNKNOWN',
          synthetic ? { NONE: 'GROSS_SETTLED' } : {},
        ),
        contract_reference: text('contract_reference'),
      };
  }
  // Source identities remain stable across row order; content version changes invalidate approvals.
  const stable =
    kind === 'ST'
      ? (row as ST_Payment_Record).source_payment_id
      : kind === 'QBO' || kind === 'QBD'
        ? (row as QB_Ledger_Entry).transaction_id && (row as QB_Ledger_Entry).line_id
          ? `${(row as QB_Ledger_Entry).account_full_name}:${(row as QB_Ledger_Entry).transaction_id}:${(row as QB_Ledger_Entry).line_id}`
          : null
        : kind === 'BANK'
          ? (row as Bank_Deposit_Row).source_transaction_id
          : row.id;
  const payload = {
    ...row,
    id: '',
    source_refs: [],
    customer_token: undefined,
    name_token: undefined,
  } as Record<string, unknown>;
  delete payload.customer_token;
  delete payload.name_token;
  row.id = await sha256(
    canonicalJson({
      company: o.companyId,
      system: kind,
      stable:
        stable && stable !== '::'
          ? stable
          : `${provenance.file_sha256}:${provenance.sheet ?? ''}:${provenance.physical_row}`,
      version: payload,
    }),
  );
  const schemaKey = (kind === 'QBD' ? 'QBO' : kind) as keyof typeof schemas;
  schemas[schemaKey].parse(row);
  if (kind === 'PROCESSOR') {
    const e = row as SettlementEvidence;
    if (
      e.status !== 'HELD' &&
      (e.fee_cents === null || e.net_cents === null || !e.settlement_reference)
    )
      throw new Error(
        'Non-held settlement evidence needs explicit fee, net and settlement identity.',
      );
  }
  return row as RowByKind[K];
}
export async function normalizeGrain(rows: AnyRow[], kind: SourceKind): Promise<AnyRow[]> {
  if (kind === 'ST') {
    const payments = rows as ST_Payment_Record[],
      groups = new Map<string, ST_Payment_Record>();
    for (const r of payments) {
      const key = r.source_payment_id ?? r.id,
        old = groups.get(key);
      if (!old) {
        groups.set(key, r);
        continue;
      }
      const comparable = (p: ST_Payment_Record) => ({
        ...p,
        id: '',
        invoice_allocations: [],
        source_refs: [],
        customer_token: null,
      });
      if (canonicalJson(comparable(old)) !== canonicalJson(comparable(r)))
        throw new Error('Conflicting versions of the same Payment ID require review.');
      if (
        r.row_grain !== 'PAYMENT_APPLICATION' &&
        canonicalJson(old.invoice_allocations) !== canonicalJson(r.invoice_allocations)
      )
        throw new Error('Repeated payment across invoices requires PAYMENT_APPLICATION grain.');
      if (r.row_grain === 'PAYMENT_APPLICATION') {
        for (const a of r.invoice_allocations) {
          const existing = old.invoice_allocations.find((x) => x.invoice_id === a.invoice_id);
          if (existing && existing.applied_cents !== a.applied_cents)
            throw new Error('Conflicting invoice application.');
          if (!existing) old.invoice_allocations.push(a);
        }
      }
      old.source_refs.push(...r.source_refs);
    }
    for (const r of groups.values()) {
      const applied = r.invoice_allocations.map((a) => a.applied_cents);
      if (
        applied.every((n) => n !== null) &&
        Math.abs(checkedSum(applied as number[])) > Math.abs(r.gross_cents)
      )
        throw new Error('Invoice allocations exceed payment budget.');
      if (
        r.row_grain === 'BATCH_SUMMARY' &&
        payments.some(
          (p) =>
            p !== r &&
            p.row_grain !== 'BATCH_SUMMARY' &&
            p.accounting_batch_id === r.accounting_batch_id,
        )
      )
        throw new Error(
          'Mixed batch summaries and payment detail are blocked to prevent double counting.',
        );
      r.invoice_allocations.sort((a, b) => a.invoice_id.localeCompare(b.invoice_id));
      if (r.source_payment_id)
        r.id = await sha256(canonicalJson({ ...r, id: '', source_refs: [], customer_token: null }));
    }
    return [...groups.values()];
  }
  if (kind === 'QBO' || kind === 'QBD') {
    const entries = rows as QB_Ledger_Entry[];
    if (entries.some((r) => r.line_grain === 'TRANSACTION_SUMMARY'))
      throw new Error(
        'Transaction summaries are not posting lines. Export a posting-line ledger to avoid summary/detail double counting.',
      );
    const unique = new Map<string, QB_Ledger_Entry>();
    for (const r of entries) {
      if (!r.transaction_id || !r.line_id) {
        unique.set(r.id, r);
        continue;
      }
      const key = `${r.account_full_name}:${r.transaction_id}:${r.line_id}`,
        old = unique.get(key);
      if (old && old.id !== r.id) throw new Error('Conflicting versions of the same ledger line.');
      if (old) old.source_refs.push(...r.source_refs);
      else unique.set(key, r);
    }
    return [...unique.values()];
  }
  return rows;
}
