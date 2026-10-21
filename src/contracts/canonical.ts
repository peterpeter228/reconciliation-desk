/** Reconciliation Desk v1. Money is integer USD cents, never binary-float dollars.
 * This is a data contract, not a complete application. Runtime validation is mandatory.
 */
export type Cents = number; // Number.isSafeInteger; abs <= 100_000_000_000 per row
export type ISODate = string; // validated YYYY-MM-DD in the company's timezone
export type Currency = "USD";
export type SourceSystem = "ST" | "QBO" | "QBD" | "BANK" | "PROCESSOR" | "AUDIT" | "RECEIPT";
export type EvidenceLevel = "CONFIRMED" | "SUPPORTED" | "SUSPECTED" | "UNKNOWN";
export interface Provenance {
  file_sha256: string;
  sheet: string | null;
  physical_row: number; // 1-based original CSV physical record / Excel row
  column_indices: Record<string, number[]>;
  raw_row_sha256: string;
  parser_version: string;
  mapping_version: string;
  /** Transaction identity derives only from the validated native report group, not Num. */
  transaction_id_derivation?: {
    kind: "QBO_TRANSACTION_JOURNAL_GROUP";
    profile_version: "qbo-transaction-journal-v1";
    transaction_id: string;
    group_physical_row: number;
    group_column_index: 0;
    group_raw_row_sha256: string;
    group_total_physical_row: number;
    group_total_raw_row_sha256: string;
  };
}
export interface BaseRecord {
  id: string; // sha256(company_id + source system + stable source identity + version)
  company_id: string; // required before ingestion; never inferred from names
  currency: Currency;
  source_refs: Provenance[];
  validation_errors: string[];
}
export type PaymentMethod = "CARD" | "CHECK" | "CASH" | "ACH" | "FINANCING" | "OTHER" | "UNKNOWN";
export interface ST_Payment_Record extends BaseRecord {
  source_payment_id: string | null;
  record_type: "PAYMENT" | "REFUND" | "PAYMENT_CORRECTION";
  row_grain: "PAYMENT" | "PAYMENT_APPLICATION" | "BATCH_SUMMARY";
  original_payment_id: string | null;
  invoice_allocations: Array<{ invoice_id: string; applied_cents: Cents | null }>;
  accounting_batch_id: string | null;
  processor_batch_id: string | null; // NOT the accounting batch ID
  deposit_id: string | null;
  payment_date: ISODate;
  batch_close_date: ISODate | null;
  batch_post_date: ISODate | null;
  export_at: string | null; // zoned ISO timestamp if supplied
  expected_settlement_date: ISODate | null;
  export_status: "PENDING" | "POSTED" | "EXPORTED" | "FAILED" | "UNKNOWN";
  export_status_basis: "SYSTEM" | "MANUALLY_MARKED" | "UNKNOWN";
  export_mode: "PAYMENT_TO_UF" | "JE_TO_CLEARING" | "FINANCE_WORKFLOW" | "UNKNOWN";
  customer_token: string | null; // company-scoped token; original stays in local source buffer
  business_unit: string | null;
  payment_method: PaymentMethod;
  card_brand: string | null;
  processor: string | null;
  merchant_id: string | null;
  bank_account_id: string | null;
  gross_cents: Cents; // actual signed payment, NOT invoice total
  reported_net_cents: Cents | null; // null is not zero
  reported_fee_cents: Cents | null;
  fee_mode: "NETTED" | "SEPARATE_INVOICE" | "GROSS_SETTLED" | "UNKNOWN";
  reference: string | null;
  gl_account_code: string | null;
  payment_status: "SUCCESS" | "PENDING" | "FAILED" | "VOID" | "UNKNOWN";
}
export interface QB_Ledger_Entry extends BaseRecord {
  qb_product: "QBO" | "QBD";
  transaction_id: string | null;
  line_id: string | null;
  transaction_type: string;
  posting_date: ISODate;
  num: string | null;
  name_token: string | null;
  memo_local: string | null; // never sent to an LLM
  account_id: string | null;
  account_full_name: string; // preserve Parent:Subaccount
  account_type: "BANK" | "OTHER_CURRENT_ASSET" | "OTHER_CURRENT_LIABILITY" | "EXPENSE" | "OTHER" | "UNKNOWN";
  split_account: string | null; // '-Split-' is a marker, not an account
  debit_cents: Cents; // nonnegative; only one of debit/credit may be positive
  credit_cents: Cents;
  signed_cents: Cents; // ALWAYS debit - credit, irrespective of normal balance
  running_balance_cents: Cents | null;
  cleared_status: "UNCLEARED" | "CLEARED" | "RECONCILED" | "UNKNOWN";
  role: "CLEARING_RECEIPT" | "CLEARING_SETTLEMENT" | "FEE" | "BANK" | "OTHER" | "UNKNOWN";
  line_grain: "POSTING_LINE" | "TRANSACTION_SUMMARY";
  linked_payment_id: string | null;
  linked_deposit_id: string | null;
  accounting_batch_id: string | null;
  is_posted_ledger: boolean; // Bank Feed 'For review' is not posted ledger
  class_name: string | null;
  location_name: string | null;
}
export interface Bank_Deposit_Row extends BaseRecord {
  bank_name: string;
  bank_account_id: string;
  source_transaction_id: string | null;
  posted_date: ISODate;
  value_date: ISODate | null;
  pending: boolean;
  signed_cents: Cents; // account inflow positive; refund/debit negative
  description_local: string;
  descriptor_tokens: string[]; // allowlisted processor / reference tokens only
  bank_type: "ACH_CREDIT" | "MERCHANT_DEPOSIT" | "CHECK_DEPOSIT" | "CASH_DEPOSIT" | "SWEEP" | "DEBIT" | "OTHER" | "UNKNOWN";
  check_number: string | null;
  trace_id: string | null;
  deposit_id: string | null;
  balance_cents: Cents | null;
  granularity: "TRANSACTION" | "DAILY_SUMMARY";
}
// Supporting envelopes do not replace the three core transaction tables.
export interface QboTransactionJournalReport {
  profile_version: "qbo-transaction-journal-v1";
  scope: "TRANSACTION_GROUPS";
  report_title: "Transaction Journal";
  report_company_name: string;
  date_label: "All Dates";
  groups: Array<{
    transaction_id: string;
    journal_num: string;
    posting_date: ISODate;
    group_physical_row: number;
    group_raw_row_sha256: string;
    posting_physical_rows: number[];
    total_physical_row: number;
    total_raw_row_sha256: string;
    debit_cents: Cents;
    credit_cents: Cents;
  }>;
  total_physical_row: number;
  total_raw_row_sha256: string;
  debit_cents: Cents;
  credit_cents: Cents;
  footer_physical_row: number;
  footer_raw_row_sha256: string;
  generated_at: string;
  /** Change detection only, not authentication of a report or reviewer. */
  normalized_rows_sha256: string;
  manifest_payload_sha256: string;
}
export interface ImportManifest {
  company_id: string;
  source_system: SourceSystem;
  source_file_sha256: string;
  report_name: string;
  report_grain: string;
  period_start: ISODate;
  period_end: ISODate;
  as_of_date: ISODate;
  company_timezone: string;
  basis: "ACCRUAL" | "CASH" | "NOT_APPLICABLE" | "UNKNOWN";
  accounts: string[];
  account_balances: Array<{
    account_id: string | null;
    account_full_name: string;
    opening_debit_balance_cents: Cents | null;
    closing_debit_balance_cents: Cents | null;
    coverage_confirmed: boolean;
  }>;
  header_row: number;
  raw_row_count: number;
  normalized_row_count: number;
  excluded_summary_rows: number[];
  opening_debit_balance_cents: Cents | null; // legacy convenience: single-account only
  closing_debit_balance_cents: Cents | null;
  coverage_confirmed: boolean;
  missing_required_fields: string[];
  qbo_transaction_journal?: QboTransactionJournalReport;
}
export type Cause = "DATE_LAG" | "NET_FEE_DRIFT" | "UNBATCHED_REFUND" | "POST_EXPORT_DRIFT" | "OUT_OF_SYSTEM_DEPOSIT" | "PROCESSOR_HOLD" | "UNEXPLAINED";
export type SearchStatus = "COMPLETE" | "AMBIGUOUS" | "CANDIDATE_CAP" | "CARDINALITY_CAP" | "TIMEOUT" | "UNSUPPORTED";
export interface ReconciliationGroup {
  id: string;
  company_id: string;
  bank_account_id: string;
  clearing_account_ids: string[];
  clearing_residuals: Array<{ account_id: string; residual_debit_cents: Cents }>;
  currency: Currency;
  st_ids: string[];
  qb_ids: string[];
  bank_ids: string[];
  gross_cents: Cents; // sum of POSITIVE original receipts; excludes signed refunds/corrections
  refunds_cents: Cents; // magnitude, nonnegative
  fees_cents: Cents;
  holds_cents: Cents;
  releases_cents: Cents;
  external_receipts_cents: Cents;
  other_adjustments_cents: Cents; // signed
  bank_cents: Cents;
  unexplained_cents: Cents;
  ledger_residual_cents: Cents;
  matching_state: "UNMATCHED" | "CANDIDATE" | "PARTIAL" | "MATCHED" | "AMBIGUOUS" | "BLOCKED";
  matching_scope: "ACTIVITY_BRIDGE" | "VERIFIED_THREE_WAY";
  search_status: SearchStatus;
  diagnoses: Array<{ cause: Cause; evidence_level: EvidenceLevel; score: number; evidence_refs: string[]; missing_evidence: string[] }>;
  aje_state: "INELIGIBLE" | "DRAFT" | "APPROVED" | "EXPORTED" | "VERIFIED_IN_QB";
  source_version_hash: string;
  approved_proposal_hash: string | null; // binds accounts/date/amounts/evidence/rules, not only sources
}
