import type {
  ImportManifest,
  Provenance,
  QB_Ledger_Entry,
  QboTransactionJournalReport,
} from '../../contracts/canonical';
import type { MatrixRecord } from './csv';
import type {
  ColumnBindings,
  ParseOptions,
  ParseResult,
  FormulaControl,
  ImportIssue,
} from './types';
import { normalizeRow } from './normalize';
import { canonicalJson, checkedSum, parseDate, parseMoney, sha256 } from './primitives';

export const QBO_JOURNAL_PROFILE = 'qbo-transaction-journal-v1' as const;
export const QBO_JOURNAL_HEADERS = [
  '',
  'Transaction date',
  'Transaction type',
  'Num',
  'Name',
  'Description',
  'Account Name',
  'Debit',
  'Credit',
] as const;
export const QBO_JOURNAL_BINDINGS: ColumnBindings = {
  posting_date: 1,
  transaction_type: 2,
  num: 3,
  name: 4,
  memo_local: 5,
  account_full_name: 6,
  debit_cents: 7,
  credit_cents: 8,
};
const blank = (r: MatrixRecord) => r.values.every((v) => !v.trim());
const value = (r: MatrixRecord, col: number) => (r.values[col] ?? '').trim();
function fail(message: string, r?: MatrixRecord): never {
  throw new Error(
    `QBO Transaction Journal: ${message}${r ? ` (physical row ${r.physicalRow})` : ''}`,
  );
}
function shape(r: MatrixRecord, allowed: number[]): void {
  if (r.values.length !== 9 || r.values.some((v, i) => v.trim() && !allowed.includes(i)))
    fail('Unexpected cells or row width; this profile cannot skip unknown report content.', r);
}
function control(
  r: MatrixRecord,
  label: string,
  debit: number | null,
  credit: number | null,
  sheet: string | null,
  formulas: FormulaControl[],
  issues: ImportIssue[],
): boolean {
  shape(r, [0, 7, 8]);
  if (value(r, 0) !== label) fail('Unexpected report control label.', r);
  let valid = true;
  for (const [column, expected] of [
    [7, debit],
    [8, credit],
  ] as const) {
    const formula = r.formulaCells?.find((f) => f.column === column);
    // Formula text is NEVER evaluated. Independent totals use normalized detail only.
    if (formula) {
      let cached: number | null = null;
      try {
        cached = formula.cachedValue === null ? null : parseMoney(String(formula.cachedValue));
      } catch {
        /* invalid cache is unverified */
      }
      const status =
        cached === null || expected === null
          ? 'UNVERIFIED'
          : cached === expected
            ? 'CONSISTENT'
            : 'CONFLICT';
      formulas.push({
        sheet,
        address: formula.address,
        formula: formula.formula,
        cachedValue: formula.cachedValue,
        independentCents: expected,
        status,
      });
      if (status !== 'CONSISTENT') {
        valid = false;
        issues.push({
          code: `FORMULA_CONTROL_${status}`,
          severity: 'warning',
          physicalRow: r.physicalRow,
          message: `${formula.address}: stored control ${status.toLowerCase()}; detail preview only, accounting import needs source verification.`,
        });
      }
    } else if (expected !== null && parseMoney(value(r, column)) !== expected) {
      // Preserve the established strict CSV values-only control invariant.
      fail('Report control label or debit/credit totals do not match complete posting lines.', r);
    }
  }
  if (r.formulaCells?.some((f) => f.column !== 7 && f.column !== 8))
    fail('Formula outside a debit/credit report control.', r);
  return valid;
}
function footerDate(r: MatrixRecord): string {
  shape(r, [0]);
  // This is the observed US-English GMTZ footer, not an arbitrary blank-amount row.
  const m =
    /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) GMTZ$/.exec(
      value(r, 0),
    );
  if (!m) fail('Missing or unsupported export timestamp footer.', r);
  const month =
    [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ].indexOf(m[2]) + 1;
  const date = parseDate(
    `${m[4]}-${String(month).padStart(2, '0')}-${m[3].padStart(2, '0')}`,
    'ISO',
  )!;
  if (+m[5] < 1 || +m[5] > 12 || +m[6] > 59) fail('Invalid export timestamp time.', r);
  const hour = (+m[5] % 12) + (m[7] === 'PM' ? 12 : 0);
  const iso = `${date}T${String(hour).padStart(2, '0')}:${m[6]}:00.000Z`;
  if (
    new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(iso)) !==
    m[1]
  )
    fail('Export timestamp weekday conflicts with its calendar date.', r);
  return iso;
}
export async function journalRowsDigest(rows: QB_Ledger_Entry[]): Promise<string> {
  return sha256(
    canonicalJson(
      [...rows].sort((a, b) => a.source_refs[0].physical_row - b.source_refs[0].physical_row),
    ),
  );
}
export async function journalManifestDigest(manifest: ImportManifest): Promise<string> {
  return sha256(
    canonicalJson({
      ...manifest,
      qbo_transaction_journal: { ...manifest.qbo_transaction_journal, manifest_payload_sha256: '' },
    }),
  );
}

/** Explicit, narrow, values-only report adapter. No generic forward-fill or row dropping. */
export async function parseQboTransactionJournal(
  records: MatrixRecord[],
  options: ParseOptions,
  source: { fileHash: string; sheet: string | null; byteLength: number; parserVersion?: string },
): Promise<ParseResult<QB_Ledger_Entry>> {
  if (!options.qboTransactionJournalCompanyName?.trim())
    fail('Confirm the exact report company name independently before importing.');
  if (options.postedLedgerConfirmed !== true || options.dateFormat !== 'MDY')
    fail('Explicit posted-ledger confirmation and US MDY convention are required.');
  if (options.coverageConfirmed === true || options.accountBalances !== undefined)
    fail(
      'Transaction-scoped reports cannot establish account-period coverage or account balances.',
    );
  if (options.headerRow !== undefined && options.headerRow !== 5)
    fail('This profile requires the native header at physical row 5.');
  if (
    options.excludedTargets?.length ||
    Object.entries(options.bindings ?? {}).some(([k, v]) => QBO_JOURNAL_BINDINGS[k] !== v)
  )
    fail('This profile uses fixed column meanings; conflicting or omitted bindings are forbidden.');
  if (
    records.length < 11 ||
    records.some(
      (r, i) =>
        !Number.isSafeInteger(r.physicalRow) ||
        r.physicalRow <= 0 ||
        (i > 0 && r.physicalRow <= records[i - 1].physicalRow),
    )
  )
    fail('Report is incomplete or physical row locators are invalid.');
  for (let i = 0; i < 5; i++)
    if (records[i]?.physicalRow !== i + 1)
      fail('Native report preamble/header must occupy physical rows 1–5.');
  shape(records[0], [0]);
  shape(records[1], [0]);
  shape(records[2], [0]);
  if (value(records[0], 0) !== options.qboTransactionJournalCompanyName.trim())
    fail('Report company does not match the independently reviewed company name.');
  if (
    value(records[1], 0) !== 'Transaction Journal' ||
    value(records[2], 0) !== 'All Dates' ||
    !blank(records[3])
  )
    fail('Unsupported report title, date scope, or preamble.');
  if (
    records[4].values.length !== 9 ||
    records[4].values.some((v, i) => v.trim() !== QBO_JOURNAL_HEADERS[i])
  )
    fail('The complete native nine-column schema is required.');

  if (records.slice(0, 5).some((r) => r.formulaCells?.length))
    fail('Formula-dependent preamble or header is unsupported.');
  const excludedRows = records
    .slice(0, 4)
    .map((r) => ({ physicalRow: r.physicalRow, reason: 'Validated native report preamble' }));
  const formulaCells: FormulaControl[] = [];
  const issues: ImportIssue[] = [];
  const quarantinedGroups: NonNullable<ParseResult['controls']['quarantinedGroups']> = [];
  const accountingBlocked = new Set<string>();
  const groups: QboTransactionJournalReport['groups'] = [];
  const postings: { record: MatrixRecord; group: QboTransactionJournalReport['groups'][number] }[] =
    [];
  const seen = new Set<string>();
  let i = 5;
  while (i < records.length && value(records[i], 0) !== 'TOTAL') {
    const groupRow = records[i++];
    shape(groupRow, [0]);
    if (groupRow.formulaCells?.length)
      fail('Transaction group identity cannot derive from a formula cache.', groupRow);
    const id = value(groupRow, 0);
    if (!/^[1-9]\d{0,19}$/.test(id) || seen.has(id))
      fail('A unique positive integer transaction group ID is required.', groupRow);
    seen.add(id);
    const groupStart = i - 1;
    // Bound the entire economic group before validation, so a bad leg cannot
    // leave its otherwise valid counterpart in the accounting input.
    const boundary = records.findIndex((r, index) => index >= i && value(r, 0) !== '');
    if (boundary < 0 || value(records[boundary], 0) !== `Total for ${id}`)
      fail('Missing unambiguous transaction closing control.', groupRow);
    try {
      const detail: MatrixRecord[] = [];
      while (i < records.length && !value(records[i], 0)) {
        const row = records[i++];
        if (row.formulaCells?.length)
          fail(
            'Transaction detail formula requires a values-only source; the complete transaction is quarantined.',
            row,
          );
        if (row.values.length !== 9 || blank(row))
          fail('Blank or malformed row interrupts a transaction group.', row);
        if (value(row, 2) !== 'Journal Entry' || !value(row, 3) || !value(row, 6))
          fail('Every posting needs Journal Entry type, journal Num and account.', row);
        const date = parseDate(value(row, 1), 'MDY')!;
        if (date < options.periodStart || date > options.periodEnd)
          fail('Posting falls outside the selected date range.', row);
        if (
          detail.length &&
          (parseDate(value(detail[0], 1), 'MDY') !== date || value(detail[0], 3) !== value(row, 3))
        )
          fail('Conflicting dates or journal numbers inside one transaction group.', row);
        if (!value(row, 7) && !value(row, 8))
          fail('Unknown blank posting amount is not zero.', row);
        const debit = parseMoney(value(row, 7), true) ?? 0;
        const credit = parseMoney(value(row, 8), true) ?? 0;
        if (debit < 0 || credit < 0 || !(debit > 0 !== credit > 0))
          fail('Posting must have exactly one positive debit or credit.', row);
        detail.push(row);
      }
      if (detail.length < 2 || !records[i])
        fail('Truncated or incomplete transaction group.', groupRow);
      const debit = checkedSum(detail.map((r) => parseMoney(value(r, 7), true) ?? 0));
      const credit = checkedSum(detail.map((r) => parseMoney(value(r, 8), true) ?? 0));
      if (debit !== credit) fail('Transaction group is unbalanced.', groupRow);
      const totalRow = records[i++];
      if (!control(totalRow, `Total for ${id}`, debit, credit, source.sheet, formulaCells, issues))
        accountingBlocked.add(id);
      const group = {
        transaction_id: id,
        journal_num: value(detail[0], 3),
        posting_date: parseDate(value(detail[0], 1), 'MDY')!,
        group_physical_row: groupRow.physicalRow,
        group_raw_row_sha256: await sha256(groupRow.raw),
        posting_physical_rows: detail.map((r) => r.physicalRow),
        total_physical_row: totalRow.physicalRow,
        total_raw_row_sha256: await sha256(totalRow.raw),
        debit_cents: debit,
        credit_cents: credit,
      };
      groups.push(group);
      postings.push(...detail.map((record) => ({ record, group })));
      excludedRows.push(
        { physicalRow: groupRow.physicalRow, reason: 'Validated transaction identity group' },
        {
          physicalRow: totalRow.physicalRow,
          reason: 'Transaction subtotal control; consistency recorded separately',
        },
      );
    } catch (error) {
      // The legacy CSV profile remains atomic. Native workbook reports support
      // bounded recovery; malformed structure outside known groups is never skipped.
      if (!source.sheet) throw error;
      i = boundary + 1;
      const reason = error instanceof Error ? error.message : 'Invalid transaction';
      quarantinedGroups.push({
        transactionId: id,
        physicalRows: records.slice(groupStart, i).map((r) => r.physicalRow),
        reason,
      });
      accountingBlocked.add(id);
      issues.push({
        code: 'TRANSACTION_QUARANTINED',
        severity: 'warning',
        physicalRow: groupRow.physicalRow,
        message: reason,
      });
      for (const r of records.slice(groupStart, i))
        for (const f of r.formulaCells ?? [])
          formulaCells.push({
            sheet: source.sheet,
            address: f.address,
            formula: f.formula,
            cachedValue: f.cachedValue,
            independentCents: null,
            status: 'TRANSACTION_FORMULA',
          });
    }
  }
  if ((!groups.length && !quarantinedGroups.length) || !records[i])
    fail('Missing complete groups or grand total.');
  const totalRow = records[i++];
  const debit = checkedSum(groups.map((g) => g.debit_cents));
  const credit = checkedSum(groups.map((g) => g.credit_cents));
  if (
    !control(
      totalRow,
      'TOTAL',
      quarantinedGroups.length ? null : debit,
      quarantinedGroups.length ? null : credit,
      source.sheet,
      formulaCells,
      issues,
    )
  )
    for (const g of groups) accountingBlocked.add(g.transaction_id);
  excludedRows.push({ physicalRow: totalRow.physicalRow, reason: 'Validated report grand total' });
  while (i < records.length && blank(records[i])) {
    excludedRows.push({
      physicalRow: records[i++].physicalRow,
      reason: 'Blank after validated grand total',
    });
  }
  if (!records[i]) fail('Missing export timestamp footer; report may be truncated.');
  const footer = records[i++];
  if (footer.formulaCells?.length)
    fail('Export timestamp cannot derive from a formula cache.', footer);
  const generatedAt = footerDate(footer);
  excludedRows.push({
    physicalRow: footer.physicalRow,
    reason: 'Validated native report timestamp footer',
  });
  for (; i < records.length; i++) {
    if (!blank(records[i])) fail('Unexpected content after export timestamp footer.', records[i]);
    excludedRows.push({ physicalRow: records[i].physicalRow, reason: 'Trailing blank row' });
  }
  const mappingVersion = `${QBO_JOURNAL_PROFILE}:${await sha256(
    canonicalJson({
      profile: QBO_JOURNAL_PROFILE,
      companyId: options.companyId,
      reportCompanyName: options.qboTransactionJournalCompanyName.trim(),
      bindings: QBO_JOURNAL_BINDINGS,
      dateFormat: 'MDY',
      postedLedgerConfirmed: true,
      accountMap: options.accountMap ?? null,
    }),
  )}`;
  const rows: QB_Ledger_Entry[] = [];
  for (const { record: r, group: g } of postings) {
    const provenance: Provenance = {
      file_sha256: source.fileHash,
      sheet: source.sheet,
      physical_row: r.physicalRow,
      column_indices: Object.fromEntries(
        Object.entries(QBO_JOURNAL_BINDINGS).map(([k, col]) => [k, [col]]),
      ),
      raw_row_sha256: await sha256(r.raw),
      parser_version: source.parserVersion ?? 'csv-local-1.0',
      mapping_version: mappingVersion,
      transaction_id_derivation: {
        kind: 'QBO_TRANSACTION_JOURNAL_GROUP',
        profile_version: QBO_JOURNAL_PROFILE,
        transaction_id: g.transaction_id,
        group_physical_row: g.group_physical_row,
        group_column_index: 0,
        group_raw_row_sha256: g.group_raw_row_sha256,
        group_total_physical_row: g.total_physical_row,
        group_total_raw_row_sha256: g.total_raw_row_sha256,
      },
    };
    // Only the normalized projection receives the validated group ID. Raw row/hash and
    // physical posting locator remain unchanged; the derived value has its own locator.
    const projection = [...r.values];
    projection[0] = g.transaction_id;
    rows.push(
      await normalizeRow(
        projection,
        'QBO',
        { ...QBO_JOURNAL_BINDINGS, transaction_id: 0 },
        options,
        provenance,
      ),
    );
  }
  const accounts = [...new Set(rows.map((r) => r.account_full_name))];
  const manifest: ImportManifest = {
    company_id: options.companyId,
    source_system: 'QBO',
    source_file_sha256: source.fileHash,
    report_name: options.fileName ?? 'QBO Transaction Journal',
    report_grain: 'POSTING_LINE',
    period_start: options.periodStart,
    period_end: options.periodEnd,
    as_of_date: options.asOfDate,
    company_timezone: options.companyTimezone,
    basis: options.basis ?? 'UNKNOWN',
    accounts,
    account_balances: accounts.map((account_full_name) => ({
      account_id: null,
      account_full_name,
      opening_debit_balance_cents: null,
      closing_debit_balance_cents: null,
      coverage_confirmed: false,
    })),
    header_row: 5,
    raw_row_count: records.slice(5).filter((r) => !blank(r)).length,
    normalized_row_count: rows.length,
    excluded_summary_rows: excludedRows.map((r) => r.physicalRow),
    opening_debit_balance_cents: null,
    closing_debit_balance_cents: null,
    coverage_confirmed: false,
    missing_required_fields: accountingBlocked.size
      ? ['SOURCE_CONTROL_OR_TRANSACTION_REVIEW_REQUIRED']
      : [],
    qbo_transaction_journal: {
      profile_version: QBO_JOURNAL_PROFILE,
      scope: 'TRANSACTION_GROUPS',
      report_title: 'Transaction Journal',
      report_company_name: options.qboTransactionJournalCompanyName.trim(),
      date_label: 'All Dates',
      groups,
      total_physical_row: totalRow.physicalRow,
      total_raw_row_sha256: await sha256(totalRow.raw),
      debit_cents: debit,
      credit_cents: credit,
      footer_physical_row: footer.physicalRow,
      footer_raw_row_sha256: await sha256(footer.raw),
      generated_at: generatedAt,
      normalized_rows_sha256: await journalRowsDigest(rows),
      manifest_payload_sha256: '',
    },
  };
  manifest.qbo_transaction_journal!.manifest_payload_sha256 = await journalManifestDigest(manifest);
  return {
    ok: rows.length > 0,
    status: !rows.length ? 'BLOCKED' : accountingBlocked.size ? 'PARTIAL' : 'READY',
    rows,
    manifest,
    duplicate: false,
    mapping: {
      headers: [...QBO_JOURNAL_HEADERS],
      bindings: { ...QBO_JOURNAL_BINDINGS },
      headerRow: 5,
    },
    issues: [
      ...issues,
      {
        code: 'TRANSACTION_SCOPE_ONLY',
        severity: 'warning',
        message:
          'Validated complete journal groups only. This report does not prove company/account-period coverage, a cleared balance, or a month-end close.',
      },
    ],
    controls: {
      signedCents: 0,
      debitCents: debit,
      creditCents: credit,
      excludedRows,
      formulaCells,
      quarantinedGroups,
      accountingBlockedTransactionIds: [...accountingBlocked],
    },
  };
}
