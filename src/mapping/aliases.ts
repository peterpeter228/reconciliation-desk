/** Local-only header mapping. No model or network transport is used. */
export type SourceKind =
  'ST' | 'QBO' | 'QBD' | 'BANK' | 'PROCESSOR' | 'AUDIT' | 'RECEIPT' | 'COMPONENT';
export type ColumnBindings = Record<string, number>;
export const normalizeHeader = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_./#():-]+/g, ' ')
    .trim();
const common = {
  currency: ['Currency'],
  company_id: ['Company ID'],
  row_grain: ['Row Grain'],
  fee_mode: ['Fee Mode'],
  bank_account_id: ['Bank Account ID'],
};
const aliases: Record<SourceKind, Record<string, string[]>> = {
  ST: {
    ...common,
    source_payment_id: ['Payment ID'],
    original_payment_id: ['Related Payment ID', 'Original Payment ID'],
    record_type: ['Record Type'],
    payment_date: ['Payment Date', 'Paid On'],
    accounting_batch_id: ['Batch Number', 'Batch Name', 'Accounting Batch Number'],
    processor_batch_id: ['Processor Batch Number'],
    deposit_id: ['Deposit ID'],
    batch_close_date: ['Batch Close Date', 'Close Date'],
    batch_post_date: ['Batch Post Date', 'Post Date'],
    invoice_id: ['Invoice #', 'Invoice ID'],
    applied_cents: ['Amount Allocated', 'Applied Amount'],
    credit_remaining_cents: ['Credit Remaining'],
    customer: ['Customer Name', 'Customer'],
    business_unit: ['Business Unit'],
    payment_method: ['Payment Type', 'Payment Method'],
    processor: ['Processor'],
    merchant_id: ['Merchant ID'],
    gross_cents: ['Gross Amount', 'Payment Amount'],
    reported_net_cents: ['Net Amount'],
    reported_fee_cents: ['Fee Amount'],
    gl_account_code: ['GL Account Code'],
    export_status: ['Export Status'],
    export_status_basis: ['Export Status Basis'],
    export_mode: ['Export Mode'],
    export_at: ['Exported At'],
    expected_settlement_date: ['Expected Settlement Date'],
    payment_status: ['Payment Status', 'Transaction Status'],
    reference: ['Reference'],
    card_brand: ['Card Brand'],
  },
  QBO: {},
  QBD: {},
  BANK: {
    ...common,
    posted_date: ['Posting Date', 'Posted Date', 'Date'],
    value_date: ['Value Date'],
    description_local: ['Description', 'Memo'],
    signed_cents: ['Amount'],
    balance_cents: ['Balance', 'Running Bal.'],
    bank_type: ['Type', 'Bank Type'],
    check_number: ['Check or Slip #', 'Check Number'],
    source_transaction_id: ['Transaction ID'],
    trace_id: ['Trace ID'],
    deposit_id: ['Deposit ID', 'Deposit Reference'],
    pending: ['Pending'],
    status: ['Status'],
    details: ['Details'],
    granularity: ['Granularity'],
  },
  PROCESSOR: {
    ...common,
    id: ['Statement Line ID'],
    as_of_date: ['As Of Date'],
    payment_id: ['Payment ID'],
    accounting_batch_id: ['Accounting Batch Number'],
    processor_batch_id: ['Processor Batch Number'],
    settlement_reference: ['Settlement Reference'],
    processor: ['Processor'],
    status: ['Status'],
    gross_cents: ['Gross Amount'],
    fee_cents: ['Fee Amount'],
    net_cents: ['Net Amount'],
    held_cents: ['Amount Held'],
    scheduled_settlement_date: ['Scheduled Settlement Date'],
    actual_settlement_date: ['Actual Settlement Date'],
    contract_reference: ['Contract Reference'],
    evidence_document: ['Evidence Document'],
  },
  AUDIT: {
    ...common,
    id: ['Audit Event ID'],
    event_at: ['Event At'],
    action: ['Action'],
    original_payment_id: ['Original Payment ID'],
    correction_payment_id: ['Correction Payment ID'],
    accounting_batch_id: ['Original Accounting Batch Number'],
    original_exported_at: ['Original Exported At'],
    original_receipt_cents: ['Original Receipt Amount'],
    correction_cents: ['Correction Amount'],
    current_application_cents: ['Current Application Total'],
    cash_refund_confirmed: ['Cash Refund Confirmed'],
    evidence_document: ['Evidence Document'],
  },
  RECEIPT: {
    ...common,
    id: ['Receipt ID'],
    received_date: ['Received Date'],
    customer: ['Customer'],
    method: ['Method'],
    amount_cents: ['Amount'],
    st_payment_id: ['ST Payment ID'],
    entered_in_st: ['Entered In ST'],
    deposit_reference: ['Deposit Reference'],
    check_number: ['Check Number'],
    evidence_document: ['Evidence Document'],
  },
  COMPONENT: {
    ...common,
    deposit_reference: ['Deposit Reference'],
    bank_posting_date: ['Bank Posting Date'],
    bank_amount_cents: ['Bank Amount'],
    component_reference: ['Component Reference'],
    st_payment_id: ['ST Payment ID'],
    component_type: ['Component Type'],
    gross_cents: ['Gross Amount'],
    fee_cents: ['Fee Amount'],
    net_cents: ['Net Amount'],
    contract_reference: ['Contract Reference'],
    evidence_document: ['Evidence Document'],
  },
};
const qb = {
  ...common,
  transaction_id: ['Transaction ID'],
  line_id: ['Line ID'],
  posting_date: ['Date', 'Transaction Date'],
  transaction_type: ['Transaction Type', 'Type'],
  num: ['Num', 'Number'],
  name: ['Name'],
  memo_local: ['Memo/Description', 'Memo', 'Description'],
  account_id: ['Account ID'],
  account_full_name: ['Account', 'Account Full Name'],
  account_type: ['Account Type'],
  split_account: ['Split', 'Item Split Account'],
  debit_cents: ['Debit', 'Debits'],
  credit_cents: ['Credit', 'Credits'],
  signed_cents: ['Amount'],
  running_balance_cents: ['Balance'],
  cleared_status: ['Clr', 'Cleared'],
  role: ['Role'],
  line_grain: ['Line Grain'],
  linked_payment_id: ['Linked Payment ID'],
  linked_deposit_id: ['Linked Deposit ID', 'Deposit ID'],
  accounting_batch_id: ['Accounting Batch Number'],
  is_posted_ledger: ['Is Posted Ledger'],
  class_name: ['Class'],
  location_name: ['Location'],
};
aliases.QBO = qb;
aliases.QBD = qb;
export function mapHeaders(
  headers: string[],
  kind: SourceKind,
  manual: ColumnBindings = {},
  excludedTargets: string[] = [],
): { bindings: ColumnBindings; ambiguities: string[]; unmatched: number[] } {
  const bindings: ColumnBindings = {},
    ambiguities: string[] = [];
  for (const field of excludedTargets)
    if (!(field in aliases[kind])) ambiguities.push(`Unsupported omitted mapping target: ${field}`);
  for (const [field, names] of Object.entries(aliases[kind])) {
    if (excludedTargets.includes(field)) continue;
    const indices = headers.flatMap((h, i) =>
      names.some((n) => normalizeHeader(n) === normalizeHeader(h)) ? [i] : [],
    );
    if (indices.length === 1) bindings[field] = indices[0];
    else if (indices.length > 1 && !(field in manual))
      ambiguities.push(`Multiple columns could mean ${field}; choose a column explicitly.`);
  }
  for (const [field, index] of Object.entries(manual)) {
    if (excludedTargets.includes(field))
      ambiguities.push(`Mapping target ${field} cannot be both omitted and bound.`);
    else if (!(field in aliases[kind])) ambiguities.push(`Unsupported mapping target: ${field}`);
    else if (!Number.isInteger(index) || index < 0 || index >= headers.length)
      ambiguities.push(`Column out of bounds for ${field}`);
    else if (
      ['gross_cents', 'signed_cents', 'debit_cents', 'credit_cents'].includes(field) &&
      /\b(?:balance|invoice total|amount allocated|credit remaining)\b/.test(
        normalizeHeader(headers[index]),
      )
    )
      ambiguities.push(
        `The selected column is a balance, invoice total, or application amount, not ${field}.`,
      );
    else bindings[field] = index;
  }
  const used = Object.values(bindings);
  if (new Set(used).size !== used.length)
    ambiguities.push('One column cannot supply multiple accounting meanings.');
  return {
    bindings,
    ambiguities,
    unmatched: headers.map((_, i) => i).filter((i) => !used.includes(i)),
  };
}
export const requiredFields: Record<SourceKind, string[]> = {
  ST: ['payment_date', 'gross_cents'],
  QBO: ['posting_date', 'account_full_name', 'debit_cents', 'credit_cents'],
  QBD: ['posting_date', 'account_full_name', 'debit_cents', 'credit_cents'],
  BANK: ['posted_date', 'signed_cents'],
  PROCESSOR: [
    'id',
    'as_of_date',
    'payment_id',
    'settlement_reference',
    'status',
    'gross_cents',
    'fee_cents',
    'net_cents',
    'held_cents',
    'fee_mode',
    'evidence_document',
  ],
  AUDIT: ['id', 'event_at', 'original_payment_id', 'correction_payment_id', 'evidence_document'],
  RECEIPT: [
    'id',
    'received_date',
    'amount_cents',
    'entered_in_st',
    'deposit_reference',
    'evidence_document',
  ],
  COMPONENT: [
    'deposit_reference',
    'component_reference',
    'bank_amount_cents',
    'gross_cents',
    'fee_cents',
    'net_cents',
    'evidence_document',
  ],
};
export const allowedTargets = (kind: SourceKind): string[] => Object.keys(aliases[kind]);
