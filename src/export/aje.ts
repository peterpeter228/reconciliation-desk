import { z } from 'zod';
import { canonicalJson, checkedSum, MAX_CENTS, parseDate, sha256 } from '../ingestion/primitives';
export interface VerifiedAccount {
  id: string;
  name: string;
  type:
    'BANK' | 'OTHER_CURRENT_ASSET' | 'EXPENSE' | 'OTHER_CURRENT_LIABILITY' | 'OTHER' | 'UNKNOWN';
  exists: boolean;
  isUndepositedFunds: boolean | null;
}
export interface PostedLeg {
  transactionId: string;
  journalId: string;
  date: string;
  accountId: string;
  debitCents: number;
  creditCents: number;
  posted: boolean;
  evidenceRef: string;
}
export interface FeeCase {
  companyId: string;
  caseId: string;
  adjustmentVersion: string;
  bankAccountId: string;
  clearingAccountId: string;
  feeAccountId: string;
  accounts: VerifiedAccount[];
  grossCents: number;
  bankNetCents: number;
  confirmedFeeCents: number;
  clearingResidualCents: number;
  feeMode: 'NETTED' | 'SEPARATE_INVOICE' | 'GROSS_SETTLED' | 'UNKNOWN';
  settlementReference: string;
  settlementEvidenceRef: string;
  stEvidenceRefs: string[];
  bankEvidenceRefs: string[];
  sourceFileHashes: string[];
  mappingVersion: string;
  ruleVersion: string;
  journalDate: string;
  periodOpenConfirmed: boolean;
  netFeeConfirmed: boolean;
  receiptTransactionId: string;
  settlementTransactionId: string;
  postedGL: PostedLeg[];
  ledgerCoverage: {
    periodStart: string;
    periodEnd: string;
    asOfDate: string;
    accountIds: string[];
    confirmed: boolean;
    evidenceRef: string;
    reviewer: string;
  };
  expenseNotRecordedConfirmed: boolean;
  existingJournalIds: string[];
  existingImportStatus: 'NEVER_IMPORTED' | 'UNKNOWN' | 'PARTIAL' | 'IMPORTED';
  syntheticOnly: boolean;
}
export interface JournalLine {
  accountId: string;
  account: string;
  debitCents: number;
  creditCents: number;
  memo: string;
}
export interface FeeProposal {
  proposalId: string;
  journalId: string;
  date: string;
  feeCase: FeeCase;
  lines: JournalLine[];
  state: 'DRAFT' | 'APPROVED';
  approval: { reviewer: string; approvedAt: string; payloadHash: string } | null;
}
export interface ExportArtifact {
  content: string;
  mimeType: string;
  fileName: string;
  manifest: {
    status: 'EXPORTED_NOT_POSTED';
    compatibility: 'BETA_NOT_TARGET_TESTED';
    synthetic_only: boolean;
    proposalId: string;
    proposalHash: string;
    journalId: string;
    sourceFileHashes: string[];
    approvedBy: string;
    approvedAt: string;
    warnings: string[];
  };
}
const money = z.number().int().min(0).max(MAX_CENTS).refine(Number.isSafeInteger);
const safeText = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (s) => !/^[\s]*[=+\-@]/.test(s) && !/[\x00-\x1f\x7f]/.test(s),
    'Dangerous formula/control characters in import text',
  );
const accountSchema = z
  .object({
    id: safeText,
    name: safeText,
    type: z.enum([
      'BANK',
      'OTHER_CURRENT_ASSET',
      'EXPENSE',
      'OTHER_CURRENT_LIABILITY',
      'OTHER',
      'UNKNOWN',
    ]),
    exists: z.boolean(),
    isUndepositedFunds: z.boolean().nullable(),
  })
  .strict();
const legSchema = z
  .object({
    transactionId: safeText,
    journalId: safeText,
    date: z.string(),
    accountId: safeText,
    debitCents: money,
    creditCents: money,
    posted: z.boolean(),
    evidenceRef: safeText,
  })
  .strict()
  .refine((l) => !(l.debitCents > 0 && l.creditCents > 0), 'Invalid debit and credit');
const caseSchema = z
  .object({
    companyId: safeText,
    caseId: safeText,
    adjustmentVersion: safeText,
    bankAccountId: safeText,
    clearingAccountId: safeText,
    feeAccountId: safeText,
    accounts: z.array(accountSchema).min(3),
    grossCents: money.refine((n) => n > 0),
    bankNetCents: money.refine((n) => n > 0),
    confirmedFeeCents: money.refine((n) => n > 0),
    clearingResidualCents: money.refine((n) => n > 0),
    feeMode: z.enum(['NETTED', 'SEPARATE_INVOICE', 'GROSS_SETTLED', 'UNKNOWN']),
    settlementReference: safeText,
    settlementEvidenceRef: safeText,
    stEvidenceRefs: z.array(safeText).min(1),
    bankEvidenceRefs: z.array(safeText).min(1),
    sourceFileHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1),
    mappingVersion: safeText,
    ruleVersion: safeText,
    journalDate: z.string(),
    periodOpenConfirmed: z.boolean(),
    netFeeConfirmed: z.boolean(),
    receiptTransactionId: safeText,
    settlementTransactionId: safeText,
    postedGL: z.array(legSchema).min(4),
    ledgerCoverage: z
      .object({
        periodStart: z.string(),
        periodEnd: z.string(),
        asOfDate: z.string(),
        accountIds: z.array(safeText),
        confirmed: z.boolean(),
        evidenceRef: safeText,
        reviewer: safeText,
      })
      .strict(),
    expenseNotRecordedConfirmed: z.boolean(),
    existingJournalIds: z.array(safeText),
    existingImportStatus: z.enum(['NEVER_IMPORTED', 'UNKNOWN', 'PARTIAL', 'IMPORTED']),
    syntheticOnly: z.boolean(),
  })
  .strict();
export function assertSafeImportText(value: string): void {
  safeText.parse(value);
}
export function validateFeeCase(value: FeeCase): FeeCase {
  const c = caseSchema.parse(value);
  for (const d of [
    c.journalDate,
    c.ledgerCoverage.periodStart,
    c.ledgerCoverage.periodEnd,
    c.ledgerCoverage.asOfDate,
  ])
    parseDate(d, 'ISO');
  if (
    c.ledgerCoverage.periodStart > c.ledgerCoverage.periodEnd ||
    c.ledgerCoverage.asOfDate < c.ledgerCoverage.periodEnd ||
    c.journalDate < c.ledgerCoverage.periodStart ||
    c.journalDate > c.ledgerCoverage.periodEnd
  )
    throw new Error('Journal date must be inside the reviewed ledger scope.');
  if (!c.periodOpenConfirmed || !c.netFeeConfirmed || c.feeMode !== 'NETTED')
    throw new Error('Open period and confirmed NETTED fee evidence are mandatory.');
  if (!c.ledgerCoverage.confirmed || !c.expenseNotRecordedConfirmed)
    throw new Error(
      'Full relevant posted-ledger coverage and missing expense review are required.',
    );
  if (c.existingImportStatus !== 'NEVER_IMPORTED')
    throw new Error(
      'Prior import status is not safely new. Re-import the GL before another export.',
    );
  if (
    new Set(c.accounts.map((a) => a.id)).size !== c.accounts.length ||
    new Set(c.accounts.map((a) => a.name)).size !== c.accounts.length
  )
    throw new Error('Ambiguous chart of accounts.');
  const bank = c.accounts.find((a) => a.id === c.bankAccountId),
    clearing = c.accounts.find((a) => a.id === c.clearingAccountId),
    fee = c.accounts.find((a) => a.id === c.feeAccountId);
  if (
    !bank?.exists ||
    bank.type !== 'BANK' ||
    !clearing?.exists ||
    clearing.type !== 'OTHER_CURRENT_ASSET' ||
    clearing.isUndepositedFunds !== false ||
    !fee?.exists ||
    fee.type !== 'EXPENSE'
  )
    throw new Error(
      'Only verified existing Bank, ordinary asset clearing (not UF), and Expense accounts are supported.',
    );
  if (new Set([bank.id, clearing.id, fee.id]).size !== 3)
    throw new Error('Accounts must be distinct.');
  if ([bank.id, clearing.id, fee.id].some((id) => !c.ledgerCoverage.accountIds.includes(id)))
    throw new Error('Bank, clearing, and fee account coverage must all be reviewed.');
  if (
    c.grossCents - c.bankNetCents !== c.confirmedFeeCents ||
    c.clearingResidualCents !== c.confirmedFeeCents
  )
    throw new Error('Fee-only component equation or clearing residual is not exact.');
  if (c.receiptTransactionId === c.settlementTransactionId)
    throw new Error('Receipt and settlement must be distinct posted transactions.');
  for (const leg of c.postedGL) {
    parseDate(leg.date, 'ISO');
    if (!leg.posted) throw new Error('Bank Feed/unposted evidence cannot authorize a journal.');
    if (leg.date < c.ledgerCoverage.periodStart || leg.date > c.ledgerCoverage.periodEnd)
      throw new Error('Posting falls outside reviewed ledger scope.');
    if (!c.accounts.some((a) => a.id === leg.accountId && a.exists))
      throw new Error('Unknown posted-ledger account.');
  }
  for (const txId of [c.receiptTransactionId, c.settlementTransactionId]) {
    const legs = c.postedGL.filter((l) => l.transactionId === txId);
    if (legs.length < 2 || checkedSum(legs.map((l) => l.debitCents - l.creditCents)) !== 0)
      throw new Error('Complete balanced receipt and settlement journal evidence is required.');
  }
  const sum = (tx: string, account: string) =>
    checkedSum(
      c.postedGL
        .filter((l) => l.transactionId === tx && l.accountId === account)
        .map((l) => l.debitCents - l.creditCents),
    );
  if (
    sum(c.receiptTransactionId, clearing.id) !== c.grossCents ||
    sum(c.settlementTransactionId, bank.id) !== c.bankNetCents ||
    sum(c.settlementTransactionId, clearing.id) !== -c.bankNetCents
  )
    throw new Error(
      'Existing posted GL does not prove gross receipt and net bank settlement against this clearing account.',
    );
  if (c.postedGL.some((l) => l.accountId === fee.id && (l.debitCents || l.creditCents)))
    throw new Error(
      'A fee entry is already present. Review it instead of creating a duplicate fee.',
    );
  if (
    checkedSum(
      c.postedGL
        .filter((l) => l.accountId === clearing.id)
        .map((l) => l.debitCents - l.creditCents),
    ) !== c.clearingResidualCents
  )
    throw new Error('Supplied component ledger does not support the claimed clearing residual.');
  return c;
}
function linesFor(c: FeeCase, journalId: string): JournalLine[] {
  const fee = c.accounts.find((a) => a.id === c.feeAccountId)!,
    clearing = c.accounts.find((a) => a.id === c.clearingAccountId)!;
  const memo = `${c.syntheticOnly ? 'SYNTHETIC TEACHING ONLY - DO NOT IMPORT TO REAL BOOKS. ' : ''}Approved documented net fee ${journalId}`;
  return [
    { accountId: fee.id, account: fee.name, debitCents: c.confirmedFeeCents, creditCents: 0, memo },
    {
      accountId: clearing.id,
      account: clearing.name,
      debitCents: 0,
      creditCents: c.confirmedFeeCents,
      memo,
    },
  ];
}
export async function buildFeeProposal(input: FeeCase): Promise<FeeProposal> {
  const c = validateFeeCase(input),
    proposalId = await sha256(
      canonicalJson({
        companyId: c.companyId,
        caseId: c.caseId,
        type: 'FEE_ONLY',
        version: c.adjustmentVersion,
      }),
    ),
    journalId = `RD${proposalId.slice(0, 10).toUpperCase()}`;
  if (c.existingJournalIds.includes(journalId) || c.postedGL.some((l) => l.journalId === journalId))
    throw new Error('Journal identifier already appears in uploaded ledger.');
  return {
    proposalId,
    journalId,
    date: c.journalDate,
    feeCase: c,
    lines: linesFor(c, journalId),
    state: 'DRAFT',
    approval: null,
  };
}
const payload = (p: FeeProposal) => ({
  ...p,
  approval: p.approval ? { ...p.approval, payloadHash: '' } : null,
});
export async function approveProposal(
  draft: FeeProposal,
  reviewer: string,
  approvedAt = new Date().toISOString(),
): Promise<FeeProposal> {
  assertSafeImportText(reviewer.trim());
  if (reviewer.trim().length < 2) throw new Error('Reviewer name is required.');
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(approvedAt) || !Number.isFinite(Date.parse(approvedAt)))
    throw new Error('Approval time must be a valid UTC timestamp.');
  const expected = await buildFeeProposal(draft.feeCase);
  if (
    draft.state !== 'DRAFT' ||
    draft.approval !== null ||
    canonicalJson(draft) !== canonicalJson(expected)
  )
    throw new Error(
      'Draft content differs from the supported fee-only proposal. Rebuild and review.',
    );
  const approved: FeeProposal = {
    ...structuredClone(draft),
    state: 'APPROVED',
    approval: { reviewer: reviewer.trim(), approvedAt, payloadHash: '' },
  };
  approved.approval!.payloadHash = await sha256(canonicalJson(payload(approved)));
  return approved;
}
export async function validateApprovedProposal(p: FeeProposal): Promise<void> {
  if (p.state !== 'APPROVED' || !p.approval?.reviewer || !p.approval.approvedAt)
    throw new Error('Explicit approval is required.');
  const expected = await buildFeeProposal(p.feeCase);
  if (
    p.proposalId !== expected.proposalId ||
    p.journalId !== expected.journalId ||
    p.date !== expected.date ||
    canonicalJson(p.lines) !== canonicalJson(expected.lines)
  )
    throw new Error('Approved journal content was changed. Rebuild and reapprove.');
  if ((await sha256(canonicalJson(payload(p)))) !== p.approval.payloadHash)
    throw new Error(
      'Approval invalidated: exact proposal, evidence, accounts, date or reviewer changed.',
    );
  if (p.lines.length !== 2 || checkedSum(p.lines.map((l) => l.debitCents - l.creditCents)) !== 0)
    throw new Error('Fee-only journal must have exactly two balanced lines.');
  for (const l of p.lines) {
    assertSafeImportText(l.account);
    assertSafeImportText(l.memo);
    if (!(l.debitCents > 0 !== l.creditCents > 0))
      throw new Error('Only one positive side per line is permitted.');
  }
  assertSafeImportText(p.journalId);
}
export function artifact(content: string, p: FeeProposal, format: 'csv' | 'iif'): ExportArtifact {
  return {
    content,
    mimeType: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=us-ascii',
    fileName: `${p.feeCase.syntheticOnly ? 'SYNTHETIC_DO_NOT_IMPORT_' : ''}${p.journalId}_BETA_NOT_POSTED.${format}`,
    manifest: {
      status: 'EXPORTED_NOT_POSTED',
      compatibility: 'BETA_NOT_TARGET_TESTED',
      synthetic_only: p.feeCase.syntheticOnly,
      proposalId: p.proposalId,
      proposalHash: p.approval!.payloadHash,
      journalId: p.journalId,
      sourceFileHashes: p.feeCase.sourceFileHashes,
      approvedBy: p.approval!.reviewer,
      approvedAt: p.approval!.approvedAt,
      warnings: [
        ...(p.feeCase.syntheticOnly
          ? ['SYNTHETIC TEACHING ONLY. Never import this example into real company books.']
          : []),
        'Export is not posting. Review in a backup/sample company, then re-import GL to verify.',
        'Target QuickBooks product, region and version import has not been tested.',
        'Hash detects changes; it does not authenticate an accounting reviewer.',
        'Do not re-import a partially successful or uncertain package.',
      ],
    },
  };
}
export function createTeachingFeeCase(): FeeCase {
  const ev = 'fee_case_evidence.json:separate-synthetic-teaching-example';
  return {
    companyId: 'SYNTHETIC_TEACHING_ONLY',
    caseId: 'TEN_THOUSAND_NINE_THOUSAND_ONE_HUNDRED',
    adjustmentVersion: '1',
    bankAccountId: 'BANK',
    clearingAccountId: 'CLEARING',
    feeAccountId: 'FEES',
    accounts: [
      {
        id: 'BANK',
        name: 'Collections Checking',
        type: 'BANK',
        exists: true,
        isUndepositedFunds: false,
      },
      {
        id: 'CLEARING',
        name: 'ServiceTitan Clearing',
        type: 'OTHER_CURRENT_ASSET',
        exists: true,
        isUndepositedFunds: false,
      },
      {
        id: 'FEES',
        name: 'Merchant Financing Fees',
        type: 'EXPENSE',
        exists: true,
        isUndepositedFunds: false,
      },
      {
        id: 'AR',
        name: 'Accounts Receivable',
        type: 'OTHER',
        exists: true,
        isUndepositedFunds: false,
      },
    ],
    grossCents: 1_000_000,
    bankNetCents: 910_000,
    confirmedFeeCents: 90_000,
    clearingResidualCents: 90_000,
    feeMode: 'NETTED',
    settlementReference: 'DEMO-PAYOUT-900',
    settlementEvidenceRef: ev,
    stEvidenceRefs: [ev],
    bankEvidenceRefs: [ev],
    sourceFileHashes: ['b96a5cfa3d38c5e8b1afef1170793f93b4d3a99e6e502e4574325b8020ba160d'],
    mappingVersion: 'synthetic-teaching-1',
    ruleVersion: 'fee-only-1.0',
    journalDate: '2026-09-30',
    periodOpenConfirmed: true,
    netFeeConfirmed: true,
    receiptTransactionId: 'DEMO-RECEIPT',
    settlementTransactionId: 'DEMO-DEPOSIT',
    postedGL: [
      {
        transactionId: 'DEMO-RECEIPT',
        journalId: 'DEMO-RECEIPT',
        date: '2026-09-01',
        accountId: 'CLEARING',
        debitCents: 1_000_000,
        creditCents: 0,
        posted: true,
        evidenceRef: ev,
      },
      {
        transactionId: 'DEMO-RECEIPT',
        journalId: 'DEMO-RECEIPT',
        date: '2026-09-01',
        accountId: 'AR',
        debitCents: 0,
        creditCents: 1_000_000,
        posted: true,
        evidenceRef: ev,
      },
      {
        transactionId: 'DEMO-DEPOSIT',
        journalId: 'DEMO-DEPOSIT',
        date: '2026-09-03',
        accountId: 'BANK',
        debitCents: 910_000,
        creditCents: 0,
        posted: true,
        evidenceRef: ev,
      },
      {
        transactionId: 'DEMO-DEPOSIT',
        journalId: 'DEMO-DEPOSIT',
        date: '2026-09-03',
        accountId: 'CLEARING',
        debitCents: 0,
        creditCents: 910_000,
        posted: true,
        evidenceRef: ev,
      },
    ],
    ledgerCoverage: {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      asOfDate: '2026-09-30',
      accountIds: ['BANK', 'CLEARING', 'FEES', 'AR'],
      confirmed: true,
      evidenceRef: ev,
      reviewer: 'Fictional Demo Reviewer',
    },
    expenseNotRecordedConfirmed: true,
    existingJournalIds: [],
    existingImportStatus: 'NEVER_IMPORTED',
    syntheticOnly: true,
  };
}

/** Re-import verification is separate from download; this never accepts a checkbox as posting evidence. */
export async function verifyProposalInLedger(
  p: FeeProposal,
  rows: import('../../contracts/canonical').QB_Ledger_Entry[],
  manifests: import('../../contracts/canonical').ImportManifest[],
): Promise<{ verified: boolean; reason: string; matchingRowIds: string[] }> {
  await validateApprovedProposal(p);
  const matches = rows.filter((r) => r.company_id === p.feeCase.companyId && r.num === p.journalId);
  if (
    matches.length !== p.lines.length ||
    matches.some(
      (r) => !r.is_posted_ledger || r.posting_date !== p.date || r.line_grain !== 'POSTING_LINE',
    )
  )
    return {
      verified: false,
      reason: 'Exact posted journal lines/date not found in the re-imported ledger.',
      matchingRowIds: matches.map((r) => r.id),
    };
  for (const line of p.lines) {
    if (
      matches.filter(
        (r) =>
          r.account_full_name === line.account &&
          r.debit_cents === line.debitCents &&
          r.credit_cents === line.creditCents,
      ).length !== 1
    )
      return {
        verified: false,
        reason: 'Imported accounts or amounts do not match the approved journal.',
        matchingRowIds: matches.map((r) => r.id),
      };
    const row = matches.find((r) => r.account_full_name === line.account)!;
    if (
      !manifests.some(
        (m) =>
          m.company_id === p.feeCase.companyId &&
          (m.source_system === 'QBO' || m.source_system === 'QBD') &&
          m.coverage_confirmed &&
          m.period_start <= p.date &&
          m.period_end >= p.date &&
          m.accounts.includes(line.account) &&
          row.source_refs.some((ref) => ref.file_sha256 === m.source_file_sha256),
      )
    )
      return {
        verified: false,
        reason: 'Complete reviewed imported account coverage is required for verification.',
        matchingRowIds: matches.map((r) => r.id),
      };
  }
  return {
    verified: true,
    reason:
      'Exact approved ordinary-clearing fee journal found in reviewed posted GL. External payment/deposit workflows were not modified.',
    matchingRowIds: matches.map((r) => r.id),
  };
}
