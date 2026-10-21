import { z } from 'zod';
import type { ImportManifest, QB_Ledger_Entry } from '../../contracts/canonical';
import { validateApprovedProposal, type FeeProposal } from './aje';
import { canonicalJson, checkedSum, MAX_CENTS, parseDate } from '../ingestion/primitives';
import {
  journalManifestDigest,
  journalRowsDigest,
  QBO_JOURNAL_BINDINGS,
  QBO_JOURNAL_PROFILE,
} from '../ingestion/qbo-transaction-journal';

export interface JournalPostingMatch {
  matched: boolean;
  scope: 'EXACT_JOURNAL_POSTING_ONLY';
  periodReconciliationVerified: false;
  clearingBalanceVerified: false;
  transactionId: string | null;
  matchingRowIds: string[];
  reason: string;
}
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const locator = z.number().int().positive().refine(Number.isSafeInteger);
const money = z.number().int().min(0).max(MAX_CENTS).refine(Number.isSafeInteger);
const id = z.string().regex(/^[1-9]\d{0,19}$/);
const date = z.string().refine((s) => {
  try {
    return parseDate(s, 'ISO') === s;
  } catch {
    return false;
  }
});
const groupSchema = z
  .object({
    transaction_id: id,
    journal_num: z.string().trim().min(1),
    posting_date: date,
    group_physical_row: locator,
    group_raw_row_sha256: hash,
    posting_physical_rows: z.array(locator).min(2),
    total_physical_row: locator,
    total_raw_row_sha256: hash,
    debit_cents: money,
    credit_cents: money,
  })
  .strict();
const proofSchema = z
  .object({
    profile_version: z.literal(QBO_JOURNAL_PROFILE),
    scope: z.literal('TRANSACTION_GROUPS'),
    report_title: z.literal('Transaction Journal'),
    report_company_name: z.string().trim().min(1),
    date_label: z.literal('All Dates'),
    groups: z.array(groupSchema).min(1),
    total_physical_row: locator,
    total_raw_row_sha256: hash,
    debit_cents: money,
    credit_cents: money,
    footer_physical_row: locator,
    footer_raw_row_sha256: hash,
    generated_at: z.string().datetime(),
    normalized_rows_sha256: hash,
    manifest_payload_sha256: hash,
  })
  .strict();
const manifestSchema = z
  .object({
    company_id: z.string().trim().min(1),
    source_system: z.literal('QBO'),
    source_file_sha256: hash,
    report_grain: z.literal('POSTING_LINE'),
    coverage_confirmed: z.literal(false),
    period_start: date,
    period_end: date,
    as_of_date: date,
    company_timezone: z.string().min(1),
    header_row: z.literal(5),
    normalized_row_count: locator,
    raw_row_count: locator,
    missing_required_fields: z.array(z.string()).length(0),
    accounts: z.array(z.string().min(1)).min(1),
    account_balances: z
      .array(
        z
          .object({
            account_id: z.null(),
            account_full_name: z.string().min(1),
            opening_debit_balance_cents: z.null(),
            closing_debit_balance_cents: z.null(),
            coverage_confirmed: z.literal(false),
          })
          .strict(),
      )
      .min(1),
    opening_debit_balance_cents: z.null(),
    closing_debit_balance_cents: z.null(),
    excluded_summary_rows: z.array(locator),
    qbo_transaction_journal: proofSchema,
  })
  .passthrough();
const derivationSchema = z
  .object({
    kind: z.literal('QBO_TRANSACTION_JOURNAL_GROUP'),
    profile_version: z.literal(QBO_JOURNAL_PROFILE),
    transaction_id: id,
    group_physical_row: locator,
    group_column_index: z.literal(0),
    group_raw_row_sha256: hash,
    group_total_physical_row: locator,
    group_total_raw_row_sha256: hash,
  })
  .strict();
const rowSchema = z
  .object({
    id: hash,
    company_id: z.string().min(1),
    currency: z.literal('USD'),
    qb_product: z.literal('QBO'),
    transaction_id: id,
    transaction_type: z.literal('Journal Entry'),
    line_id: z.null(),
    num: z.string().trim().min(1),
    posting_date: date,
    account_full_name: z.string().min(1),
    debit_cents: money,
    credit_cents: money,
    signed_cents: z.number().int().min(-MAX_CENTS).max(MAX_CENTS).refine(Number.isSafeInteger),
    is_posted_ledger: z.literal(true),
    line_grain: z.literal('POSTING_LINE'),
    validation_errors: z.array(z.string()).length(0),
    source_refs: z
      .array(
        z
          .object({
            file_sha256: hash,
            raw_row_sha256: hash,
            physical_row: locator,
            sheet: z.string().nullable(),
            column_indices: z.record(
              z.array(z.number().int().nonnegative().refine(Number.isSafeInteger)),
            ),
            parser_version: z.string().trim().min(1),
            mapping_version: z.string().regex(/^qbo-transaction-journal-v1:[0-9a-f]{64}$/),
            transaction_id_derivation: derivationSchema,
          })
          .strict(),
      )
      .length(1),
  })
  .passthrough()
  .refine(
    (r) =>
      r.signed_cents === r.debit_cents - r.credit_cents && r.debit_cents > 0 !== r.credit_cents > 0,
  );

/**
 * Narrow proof of an exact approved posting in a complete native transaction report.
 * Not a VERIFIED_IN_QB lifecycle transition, account rollforward, or period close.
 * Hashes detect changed parsed evidence; they do not authenticate uploaded source files.
 */
export async function matchProposalJournalPosting(
  p: FeeProposal,
  rows: QB_Ledger_Entry[],
  manifests: ImportManifest[],
): Promise<JournalPostingMatch> {
  await validateApprovedProposal(p);
  const result: JournalPostingMatch = {
    matched: false,
    scope: 'EXACT_JOURNAL_POSTING_ONLY',
    periodReconciliationVerified: false,
    clearingBalanceVerified: false,
    transactionId: null,
    matchingRowIds: [],
    reason: '',
  };
  const no = (reason: string) => ({ ...result, reason });
  try {
    const matches = rows.filter(
      (r) => r.company_id === p.feeCase.companyId && r.num === p.journalId,
    );
    result.matchingRowIds = matches.map((r) => r.id);
    if (matches.length !== p.lines.length || matches.some((r) => !rowSchema.safeParse(r).success))
      return no(
        'Exact approved posted USD journal lines and valid native-report provenance are required.',
      );
    const txId = matches[0].transaction_id!;
    if (matches.some((r) => r.transaction_id !== txId || r.posting_date !== p.date))
      return no(
        'Journal number alone is not identity; one consistent transaction group and date are required.',
      );
    const transactionRows = rows.filter(
      (r) =>
        r.company_id === p.feeCase.companyId && r.qb_product === 'QBO' && r.transaction_id === txId,
    );
    if (transactionRows.length !== matches.length)
      return no('The transaction has extra or conflicting posting legs.');
    const fileHash = matches[0].source_refs[0].file_sha256;
    if (matches.some((r) => r.source_refs[0].file_sha256 !== fileHash))
      return no('All approved journal legs must come from the same complete native report.');
    const candidates = manifests.filter((m) => m.source_file_sha256 === fileHash);
    if (candidates.length !== 1 || !manifestSchema.safeParse(candidates[0]).success)
      return no(
        'One intact, transaction-scoped native report manifest is required; period coverage cannot be asserted.',
      );
    const manifest = candidates[0];
    const proof = manifest.qbo_transaction_journal!;
    if (
      manifest.company_id !== p.feeCase.companyId ||
      manifest.period_start > manifest.period_end ||
      manifest.as_of_date < manifest.period_end ||
      p.date < manifest.period_start ||
      p.date > manifest.period_end
    )
      return no('Report company or date scope conflicts with the approved proposal.');
    if ((await journalManifestDigest(manifest)) !== proof.manifest_payload_sha256)
      return no('Native report manifest changed after validation.');
    const reportRows = rows.filter((r) =>
      r.source_refs?.some((ref) => ref.file_sha256 === fileHash),
    );
    if (
      reportRows.length !== manifest.normalized_row_count ||
      reportRows.some(
        (r) => !rowSchema.safeParse(r).success || r.company_id !== manifest.company_id,
      )
    )
      return no('The complete parsed report row set and its company/provenance are required.');
    if ((await journalRowsDigest(reportRows)) !== proof.normalized_rows_sha256)
      return no('Native report postings or provenance changed after validation.');
    if (
      new Set(reportRows.map((r) => r.id)).size !== reportRows.length ||
      new Set(proof.groups.map((g) => g.transaction_id)).size !== proof.groups.length
    )
      return no('Duplicate row or transaction identities make this report ambiguous.');
    const expectedColumns = Object.fromEntries(
      Object.entries(QBO_JOURNAL_BINDINGS).map(([k, col]) => [k, [col]]),
    );
    const mapping = reportRows[0].source_refs[0].mapping_version;
    const sheet = reportRows[0].source_refs[0].sheet;
    const allLocators = new Set<number>();
    let priorTotal = 5;
    for (const g of proof.groups) {
      const groupRows = reportRows
        .filter((r) => r.transaction_id === g.transaction_id)
        .sort((a, b) => a.source_refs[0].physical_row - b.source_refs[0].physical_row);
      if (
        g.group_physical_row <= priorTotal ||
        g.total_physical_row <= g.group_physical_row ||
        g.debit_cents <= 0 ||
        g.debit_cents !== g.credit_cents ||
        groupRows.length !== g.posting_physical_rows.length ||
        canonicalJson(groupRows.map((r) => r.source_refs[0].physical_row)) !==
          canonicalJson(g.posting_physical_rows)
      )
        return no(
          'Complete, noninterleaved transaction group boundaries and posting membership are required.',
        );
      for (const row of groupRows) {
        const ref = row.source_refs[0],
          d = ref.transaction_id_derivation!;
        if (
          allLocators.has(ref.physical_row) ||
          ref.physical_row <= g.group_physical_row ||
          ref.physical_row >= g.total_physical_row ||
          ref.sheet !== sheet ||
          ref.mapping_version !== mapping ||
          canonicalJson(ref.column_indices) !== canonicalJson(expectedColumns) ||
          row.num !== g.journal_num ||
          row.posting_date !== g.posting_date ||
          row.posting_date < manifest.period_start ||
          row.posting_date > manifest.period_end ||
          d.transaction_id !== g.transaction_id ||
          d.group_physical_row !== g.group_physical_row ||
          d.group_raw_row_sha256 !== g.group_raw_row_sha256 ||
          d.group_total_physical_row !== g.total_physical_row ||
          d.group_total_raw_row_sha256 !== g.total_raw_row_sha256
        )
          return no(
            'Posting identity derivation does not match the source group, controls, date, and row locator.',
          );
        allLocators.add(ref.physical_row);
      }
      if (
        checkedSum(groupRows.map((r) => r.debit_cents)) !== g.debit_cents ||
        checkedSum(groupRows.map((r) => r.credit_cents)) !== g.credit_cents
      )
        return no('Transaction group controls no longer match its postings.');
      priorTotal = g.total_physical_row;
    }
    if (
      allLocators.size !== reportRows.length ||
      proof.total_physical_row <= priorTotal ||
      proof.footer_physical_row <= proof.total_physical_row ||
      checkedSum(reportRows.map((r) => r.debit_cents)) !== proof.debit_cents ||
      checkedSum(reportRows.map((r) => r.credit_cents)) !== proof.credit_cents
    )
      return no('Report membership, grand totals, or terminal footer are inconsistent.');
    const mandatoryExcluded = new Set([
      1,
      2,
      3,
      4,
      ...proof.groups.flatMap((g) => [g.group_physical_row, g.total_physical_row]),
      proof.total_physical_row,
      proof.footer_physical_row,
    ]);
    const excluded = new Set(manifest.excluded_summary_rows);
    // Before TOTAL, only the preamble and group controls may be excluded. Optional
    // blank records occur after TOTAL. Their complete inventory is not retained in
    // this proof, and CSV continuation lines are not separate records: do not infer
    // a full physical-row complement or source authenticity from these locators.
    if (
      excluded.size !== manifest.excluded_summary_rows.length ||
      [...mandatoryExcluded].some((row) => !excluded.has(row)) ||
      manifest.excluded_summary_rows.some(
        (row) =>
          row === manifest.header_row ||
          allLocators.has(row) ||
          (row <= proof.total_physical_row && !mandatoryExcluded.has(row)),
      )
    )
      return no(
        'Native report exclusions must uniquely classify all controls and no posting/header rows.',
      );
    // raw_row_count counts nonempty records after the header, not physical lines
    // or the optional blank records included in excluded_summary_rows.
    if (manifest.raw_row_count !== reportRows.length + proof.groups.length * 2 + 2)
      return no('Native report nonempty record count does not match postings and controls.');
    const accounts = [...new Set(reportRows.map((r) => r.account_full_name))].sort();
    if (
      canonicalJson(accounts) !== canonicalJson([...manifest.accounts].sort()) ||
      canonicalJson(accounts) !==
        canonicalJson(manifest.account_balances.map((b) => b.account_full_name).sort())
    )
      return no('Report account inventory does not match complete posting lines.');
    for (const line of p.lines) {
      if (
        matches.filter(
          (r) =>
            r.account_full_name === line.account &&
            r.debit_cents === line.debitCents &&
            r.credit_cents === line.creditCents &&
            r.memo_local === line.memo,
        ).length !== 1
      )
        return no('Accounts, amounts, or descriptions differ from the exact approved journal.');
    }
    return {
      ...result,
      matched: true,
      transactionId: txId,
      reason:
        'Exact approved journal posting found in validated complete QBO transaction group. Account-period coverage, clearing balances, and a full reconciliation are NOT verified.',
    };
  } catch {
    return no('Malformed or incomplete native journal evidence cannot establish a posting match.');
  }
}
