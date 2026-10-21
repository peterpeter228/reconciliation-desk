import type {
  Bank_Deposit_Row,
  ImportManifest,
  QB_Ledger_Entry,
  ST_Payment_Record,
} from '../../contracts/canonical';
import type { ColumnBindings, SourceKind } from '../mapping/aliases';
export type { SourceKind, ColumnBindings };
export interface AccountMapping {
  accountType: QB_Ledger_Entry['account_type'];
  role?: 'CLEARING' | 'BANK' | 'FEE' | 'OTHER';
  isUndepositedFunds?: boolean;
}
export interface ParseOptions {
  companyId: string;
  bankAccountId: string;
  companyTimezone: string;
  periodStart: string;
  periodEnd: string;
  asOfDate: string;
  currency: 'USD';
  fileName?: string;
  profile?: 'synthetic-v1' | 'manual' | 'qbo-transaction-journal-v1';
  /** Independently reviewed company label; never inferred from the local company ID. */
  qboTransactionJournalCompanyName?: string;
  bindings?: ColumnBindings;
  excludedTargets?: string[];
  headerRow?: number;
  seenFileHashes?: string[];
  dateFormat?: 'MDY' | 'ISO';
  delimiter?: ',' | ';' | '\t';
  rowGrain?: ST_Payment_Record['row_grain'];
  exportMode?: ST_Payment_Record['export_mode'];
  postedLedgerConfirmed?: boolean;
  bankPostedConfirmed?: boolean;
  bankSignConvention?: 'INFLOW_POSITIVE';
  bankName?: string;
  accountMap?: Record<string, AccountMapping>;
  basis?: ImportManifest['basis'];
  coverageConfirmed?: boolean;
  accountBalances?: ImportManifest['account_balances'];
  existingTotalBytes?: number;
  /** Explicit original CSV byte encoding; UTF-8 by default. The UI supports UTF-8 only. */
  encoding?: 'utf-8' | 'utf-16le' | 'utf-16be';
  originalBytes?: Uint8Array;
}
export interface ImportIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  physicalRow?: number;
}
export type CoreRow = ST_Payment_Record | QB_Ledger_Entry | Bank_Deposit_Row;
export interface ParseResult<T = CoreRow> {
  ok: boolean;
  rows: T[];
  manifest: ImportManifest | null;
  issues: ImportIssue[];
  mapping: { headers: string[]; bindings: ColumnBindings; headerRow: number } | null;
  duplicate: boolean;
  controls: {
    signedCents: number;
    debitCents: number | null;
    creditCents: number | null;
    excludedRows: { physicalRow: number; reason: string }[];
  };
}
