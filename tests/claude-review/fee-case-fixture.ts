import { readFileSync } from 'node:fs';
import { parseSource } from '../../src/ingestion';
import { reconcile } from '../../src/engine';
import { initializeReview, reviewForGroup } from '../../src/review/project';
import { initialFacts, type CaseFacts } from '../../src/review/case-adapter';
import type { ParseOptions, SourceKind } from '../../src/ingestion/types';
import type { Workspace, SourceFile } from '../../src/components/workspace';
import type { ReconcileInput } from '../../src/contracts/engine';
import type {
  QB_Ledger_Entry,
  ST_Payment_Record,
  Bank_Deposit_Row,
} from '../../src/contracts/canonical';
import type { SettlementEvidence } from '../../src/contracts/engine';

export const FIXTURE_DIR = 'tests/fixtures/fee-case-csv/';
export const fixtureFiles = {
  ST: 'st_payments.csv',
  QBO: 'qbo_general_ledger.csv',
  BANK: 'bank_activity.csv',
  PROCESSOR: 'processor_settlement.csv',
} as const;
/** Same payment, still in Undeposited Funds: no deposit has been recorded in the GL. */
export const ufLedgerFile = 'qbo_uf_ledger.csv';
export const ufOptions: Partial<ParseOptions> = {
  accountMap: {
    'Undeposited Funds': {
      accountType: 'OTHER_CURRENT_ASSET',
      role: 'CLEARING',
      isUndepositedFunds: true,
    },
  },
};

/** Mirrors the import page's confirmed manual options; every value is synthetic. */
export const sessionOptions: ParseOptions = {
  allowPartialTransactions: false,
  ledgerReportScope: 'COMPLETE_JOURNAL',
  companyId: 'Synthetic HVAC Co',
  bankAccountId: 'Collections Checking',
  companyTimezone: 'America/New_York',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  asOfDate: '2026-09-30',
  currency: 'USD',
  profile: 'manual',
  dateFormat: 'MDY',
  rowGrain: 'PAYMENT',
  exportMode: 'JE_TO_CLEARING',
  postedLedgerConfirmed: true,
  bankPostedConfirmed: true,
  bankSignConvention: 'INFLOW_POSITIVE',
  coverageConfirmed: true,
  basis: 'ACCRUAL',
  bankName: '',
  accountMap: {
    'ServiceTitan Clearing': {
      accountType: 'OTHER_CURRENT_ASSET',
      role: 'CLEARING',
      isUndepositedFunds: false,
    },
  },
};

export function fixtureBytes(
  kind: keyof typeof fixtureFiles,
  name: string = fixtureFiles[kind],
): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE_DIR + name));
}

async function parse(
  kind: keyof typeof fixtureFiles,
  override: Partial<ParseOptions> = {},
  name: string = fixtureFiles[kind],
) {
  const bytes = fixtureBytes(kind, name);
  const options = { ...sessionOptions, ...override };
  const result = await parseSource(new TextDecoder().decode(bytes), kind as SourceKind, {
    ...options,
    fileName: name,
    originalBytes: bytes,
  });
  if (!result.ok || !result.manifest)
    throw new Error(`${kind}: ${result.issues.map((i) => i.code).join(',')}`);
  const file: SourceFile = {
    name,
    kind,
    hash: result.manifest.source_file_sha256,
    sizeBytes: bytes.byteLength,
    mapping: result.mapping,
    controls: result.controls,
    importStatus: result.status,
    parseOptions: options,
  };
  return { result, file };
}

/** Real parser + real engine output, as the browser session would hold it. */
export async function sessionWorkspace(
  variant: 'clearing' | 'uf' = 'clearing',
): Promise<Workspace> {
  const override = variant === 'uf' ? ufOptions : {};
  const st = await parse('ST', override),
    qb = await parse('QBO', override, variant === 'uf' ? ufLedgerFile : fixtureFiles.QBO),
    bank = await parse('BANK', override),
    proc = await parse('PROCESSOR', override);
  const input: ReconcileInput = {
    st: st.result.rows as ST_Payment_Record[],
    qb: qb.result.rows as QB_Ledger_Entry[],
    bank: bank.result.rows as Bank_Deposit_Row[],
    manifests: [st, qb, bank, proc].map((x) => x.result.manifest!),
    evidence: { settlements: proc.result.rows as SettlementEvidence[] },
    config: {
      company_id: sessionOptions.companyId,
      bank_account_id: sessionOptions.bankAccountId,
      period_cutoff: sessionOptions.periodEnd,
      clearing_split_semantics_confirmed: false,
      qb_bank_account_names: ['Collections Checking'],
    },
  };
  const w: Workspace = {
    input,
    result: reconcile(structuredClone(input)),
    duration: 0,
    isDemo: false,
    files: [st.file, qb.file, bank.file, proc.file],
    options: { ...sessionOptions, ...override },
    runId: `fee-case-session-${variant}`,
  };
  w.review = initializeReview(w);
  return w;
}

export function feeGroup(w: Workspace) {
  const g = w.result.groups.find((x) => x.st_ids.length && x.bank_ids.length);
  if (!g) throw new Error('Fixture no longer produces the linked fee case.');
  return g;
}

export function documentedFacts(w: Workspace): CaseFacts {
  return {
    ...initialFacts(w),
    reviewer: 'Synthetic reviewer',
    notes: 'Synthetic netted processor fee; posted gross receipt and net bank deposit.',
    journalDate: '2026-09-30',
    bankAccountName: 'Collections Checking',
    clearingAccountName: 'ServiceTitan Clearing',
    feeAccountName: 'Merchant Processing Fees',
    receiptTransactionId: 'SYN-QB-R900',
    settlementTransactionId: 'SYN-QB-D900',
    documentedFee: '900.00',
    feeMode: 'NETTED',
    netFeeConfirmed: true,
    periodOpenConfirmed: true,
    expenseNotRecordedConfirmed: true,
    completeLedgerConfirmed: true,
    ledgerCoveredAccountNames: [
      'ServiceTitan Clearing',
      'Accounts Receivable',
      'Collections Checking',
      'Merchant Processing Fees',
    ].join('\n'),
    ledgerPeriodStart: '2026-09-01',
    ledgerPeriodEnd: '2026-09-30',
    accountsReviewed: true,
    clearingIsOrdinaryAsset: true,
    documents: (['COA', 'SETTLEMENT', 'LEDGER'] as const).map((purpose, i) => ({
      purpose,
      name: `synthetic-${purpose.toLowerCase()}.txt`,
      sha256: String(i + 1).repeat(64),
      sizeBytes: 10,
    })),
    reviewedAccounts: [
      ['Collections Checking', 'BANK'],
      ['ServiceTitan Clearing', 'OTHER_CURRENT_ASSET'],
      ['Merchant Processing Fees', 'EXPENSE'],
      ['Accounts Receivable', 'OTHER'],
    ].map(([name, type]) => ({
      id: name,
      name,
      type: type as CaseFacts['reviewedAccounts'][number]['type'],
      exists: true,
      isUndepositedFunds: false,
    })),
    relations: [],
  };
}

export function withFacts(w: Workspace, facts: CaseFacts): Workspace {
  const next = structuredClone(w);
  const g = feeGroup(next);
  reviewForGroup(next.review!, g.id)!.reviewedFacts = { ...facts };
  return next;
}
