import type {
  Bank_Deposit_Row,
  Cents,
  ImportManifest,
  ISODate,
  Provenance,
  QB_Ledger_Entry,
  ReconciliationGroup,
  SearchStatus,
  ST_Payment_Record,
} from './canonical';

export interface EvidenceBase {
  id: string;
  company_id: string;
  currency: 'USD';
  bank_account_id: string;
  source_refs: Provenance[];
  evidence_ref: string;
}
export interface SettlementEvidence extends EvidenceBase {
  payment_id: string;
  accounting_batch_id: string | null;
  processor_batch_id: string | null;
  settlement_reference: string | null;
  processor: string | null;
  merchant_id: string | null;
  status: 'SETTLED' | 'HELD' | 'PENDING' | 'REFUNDED' | 'UNKNOWN';
  gross_cents: Cents;
  fee_cents: Cents | null;
  net_cents: Cents | null;
  held_cents: Cents;
  released_cents?: Cents;
  fee_mode: 'NETTED' | 'SEPARATE_INVOICE' | 'GROSS_SETTLED' | 'UNKNOWN';
  as_of_date: ISODate;
  scheduled_settlement_date: ISODate | null;
  actual_settlement_date: ISODate | null;
  contract_reference: string | null;
  /** Must be true only when the source really covers releases through as_of_date. */
  release_coverage_confirmed?: boolean;
}
export interface DepositComponentEvidence extends EvidenceBase {
  deposit_reference: string;
  component_reference: string;
  payment_id: string | null;
  component_type: 'NETTED_FINANCING' | 'ST_CHECK' | 'OFFICE_CHECK' | 'OTHER';
  gross_cents: Cents;
  fee_cents: Cents;
  net_cents: Cents;
  bank_amount_cents: Cents;
  posted_date: ISODate;
  fee_mode: 'NETTED' | 'SEPARATE_INVOICE' | 'GROSS_SETTLED' | 'UNKNOWN';
  contract_reference: string | null;
}
export interface ExternalReceiptEvidence extends EvidenceBase {
  receipt_id: string;
  deposit_reference: string;
  received_date: ISODate;
  amount_cents: Cents;
  entered_in_st: boolean;
  business_nature: 'CUSTOMER_RECEIPT' | 'TRANSFER' | 'LOAN' | 'OWNER_CONTRIBUTION' | 'UNKNOWN';
  independently_verified: boolean;
  check_number?: string | null;
}
export interface AuditEvidence extends EvidenceBase {
  original_payment_id: string;
  correction_payment_id: string | null;
  original_exported_at: string;
  event_at: string;
  action: string;
  original_receipt_cents: Cents;
  correction_cents: Cents;
  cash_refund_confirmed: boolean;
  expected_qb_effect_cents?: Cents;
  qb_object_id?: string;
  qb_object_coverage_confirmed?: boolean;
  sync_observation_complete?: boolean;
}
/** Itemized accountant attestation: provenance is required; UI booleans alone are not evidence. */
export interface AccountingConfirmation extends EvidenceBase {
  deposit_reference: string;
  qb_transaction_id: string;
  bank_effect_cents: Cents;
  expense_coverage_confirmed: boolean;
  fee_not_recorded: boolean;
  /** Exact ST refund payment covered by the attestation; a deposit ID alone is insufficient. */
  refund_payment_id?: string;
  refund_coverage_confirmed?: boolean;
  refund_not_recorded?: boolean;
  batching_due_date?: ISODate;
  clearing_account_id: string;
  fee_account_name: string;
  accounts_verified: boolean;
  period_open: boolean;
  reviewer: string;
}
export interface EvidenceBundle {
  settlements?: SettlementEvidence[];
  deposit_components?: DepositComponentEvidence[];
  external_receipts?: ExternalReceiptEvidence[];
  audit_events?: AuditEvidence[];
  confirmations?: AccountingConfirmation[];
}
export interface CalendarConfig {
  holidays?: ISODate[];
  version?: string;
}
export interface SearchLimits {
  max_candidates?: number;
  max_members?: number;
  max_nodes?: number;
  budget_ms?: number;
  total_budget_ms?: number;
}
export interface ReconcileInput {
  st: ST_Payment_Record[];
  qb: QB_Ledger_Entry[];
  bank: Bank_Deposit_Row[];
  manifests: ImportManifest[];
  evidence?: EvidenceBundle;
  config?: {
    company_id?: string;
    bank_account_id?: string;
    period_cutoff?: ISODate;
    calendar?: CalendarConfig;
    search?: SearchLimits;
    /** Full names of verified selected bank accounts, not a guessed Split label. */
    qb_bank_account_names?: string[];
    /** Explicit adapter confirmation permitting clearing-leg association, never bank-leg proof. */
    clearing_split_semantics_confirmed?: boolean;
  };
}
export type EdgeKind = 'ST_QB_RECEIPT' | 'QB_BANK_SETTLEMENT' | 'ST_BANK_CASH';
export interface EdgeAssessment {
  kind: EdgeKind;
  state: 'ABSENT' | 'CANDIDATE' | 'SUPPORTED' | 'CONFIRMED' | 'CONTRADICTED';
  source_ids: string[];
  expected_cents: Cents;
  observed_cents: Cents;
  difference_cents: Cents;
  identity_refs: string[];
  evidence_refs: string[];
  missing_evidence: string[];
  rule_id: string;
  rule_version: string;
}
export interface EngineGroup extends ReconciliationGroup {
  edges: EdgeAssessment[];
  accepted: boolean;
  warnings: string[];
  evidence_refs: string[];
  fee_proposal_math_ready: boolean;
  fee_aje_draft_eligible: boolean;
  impact_cents: Cents;
  period_status:
    | 'IN_PERIOD'
    | 'SETTLED_AFTER_CUTOFF'
    | 'EXPECTED_IN_TRANSIT'
    | 'OVERDUE_UNSETTLED'
    | 'UNATTRIBUTED';
}
export interface AllocationClaim {
  atom_id: string;
  group_id: string;
  signed_allocated_cents: Cents;
  component_id: string | null;
  split_authorization_ref: string | null;
}
export interface AtomControl {
  atom_id: string;
  source: 'ST' | 'QB' | 'BANK';
  source_cents: Cents;
  allocated_cents: Cents;
  residual_cents: Cents;
  excluded_reason: string | null;
}
export interface AccountControl {
  account_id: string;
  account_full_name: string;
  debit_cents: Cents;
  credit_cents: Cents;
  activity_cents: Cents;
  opening_cents: Cents | null;
  closing_cents: Cents | null;
  calculated_closing_cents: Cents | null;
  coverage_confirmed: boolean;
  status: 'VERIFIED' | 'ACTIVITY_ONLY' | 'MISMATCH';
}
export interface SourceControls {
  st_gross_cents: Cents;
  st_refunds_cents: Cents;
  st_corrections_cents: Cents;
  qb_debits_cents: Cents;
  qb_credits_cents: Cents;
  bank_signed_cents: Cents;
  accounts: AccountControl[];
  atoms: AtomControl[];
  conservation_ok: boolean;
  coverage_confirmed: boolean;
}
export interface SearchScope {
  id: string;
  bank_ids: string[];
  candidate_ids: string[];
  status: SearchStatus;
  solution_ids: string[][];
  visited_nodes: number;
  complete: boolean;
}
export interface EngineWarning {
  code: string;
  message: string;
  source_ids: string[];
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
}
export interface ReconcileResult {
  groups: EngineGroup[];
  controls: SourceControls;
  warnings: EngineWarning[];
  allocations: AllocationClaim[];
  searches: SearchScope[];
  rejected_candidates: Array<{ source_ids: string[]; reason: string }>;
  versions: { engine: string; rules: string; calendar: string; mapping: string[] };
}
