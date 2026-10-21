import Papa from 'papaparse';
import type { ImportManifest, SourceSystem } from '../../contracts/canonical';
import { mapHeaders, normalizeHeader, requiredFields } from '../mapping/aliases';
import type { ParseOptions, ParseResult, SourceKind } from './types';
import { normalizeGrain, normalizeRow, type AnyRow, type RowByKind } from './normalize';
import { canonicalJson, checkedSum, MAX_CENTS, parseDate, sha256 } from './primitives';
export interface MatrixRecord {
  values: string[];
  physicalRow: number;
  raw: string;
}
export const IMPORT_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  totalBytes: 30 * 1024 * 1024,
  rows: 20_000,
  columns: 80,
  cellBytes: 4096,
} as const;
const detailIdentityOrDateFields = new Set([
  'source_payment_id',
  'transaction_id',
  'line_id',
  'source_transaction_id',
  'id',
  'payment_id',
  'original_payment_id',
  'correction_payment_id',
  'st_payment_id',
  'component_reference',
  'accounting_batch_id',
  'payment_date',
  'posting_date',
  'posted_date',
  'received_date',
  'bank_posting_date',
  'as_of_date',
  'event_at',
]);
function isReportSummary(values: string[], bindings: Record<string, number>): boolean {
  const labelIndex = values.findIndex((v) => v.trim());
  if (
    labelIndex < 0 ||
    !/^(?:(?:TOTAL|SUBTOTAL)(?:\s+FOR\b.*)?|(?:BEGINNING|OPENING|ENDING)\s+BALANCE)\s*:?$/i.test(
      values[labelIndex].trim(),
    )
  )
    return false;
  // A name or memo beginning with "Total" is not a report control. Preserve
  // rows with independent detail identity/date cells for normal validation,
  // including invalid dates, so malformed transactions are not silently lost.
  return !Object.entries(bindings).some(
    ([field, index]) =>
      index !== labelIndex && detailIdentityOrDateFields.has(field) && values[index]?.trim(),
  );
}
function empty<K extends SourceKind>(): ParseResult<RowByKind[K]> {
  return {
    ok: false,
    rows: [],
    manifest: null,
    issues: [],
    mapping: null,
    duplicate: false,
    controls: { signedCents: 0, debitCents: null, creditCents: null, excludedRows: [] },
  };
}
/** Tracks source line starts correctly even when quoted cells contain newlines. */
function recordsWithLocators(text: string): { raw: string; physicalRow: number }[] {
  const records: { raw: string; physicalRow: number }[] = [];
  let quoted = false,
    start = 0,
    line = 1,
    startLine = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (text[i] === '\r' || text[i] === '\n') {
      const end = i;
      if (text[i] === '\r' && text[i + 1] === '\n') i++;
      line++;
      if (!quoted) {
        records.push({ raw: text.slice(start, end), physicalRow: startLine });
        start = i + 1;
        startLine = line;
      }
    }
  }
  if (start < text.length) records.push({ raw: text.slice(start), physicalRow: startLine });
  return records;
}
export async function parseSource<K extends SourceKind>(
  text: string,
  kind: K,
  options: ParseOptions,
): Promise<ParseResult<RowByKind[K]>> {
  const result = empty<K>();
  try {
    const bytes = options.originalBytes ?? new TextEncoder().encode(text);
    if (
      bytes.byteLength > IMPORT_LIMITS.fileBytes ||
      bytes.byteLength + (options.existingTotalBytes ?? 0) > IMPORT_LIMITS.totalBytes
    )
      throw new Error('File exceeds 10 MB per-file or 30 MB workspace limit.');
    if (options.fileName && !/\.(csv|tsv|txt)$/i.test(options.fileName))
      throw new Error(
        'This parser accepts CSV/TSV only. Use the separately validated XLSX importer for workbooks.',
      );
    if (text.includes('\0') || text.includes('\ufffd'))
      throw new Error('Invalid encoding. Select a supported encoding and decode before parsing.');
    const body = text.replace(/^\uFEFF/, '');
    const parsed = Papa.parse<string[]>(body, {
      delimiter: options.delimiter ?? '',
      skipEmptyLines: false,
      dynamicTyping: false,
    });
    const fatal = parsed.errors.filter((e) => e.code !== 'UndetectableDelimiter');
    if (fatal.length) throw new Error(`Malformed CSV: ${fatal.map((e) => e.code).join(', ')}`);
    const locators = recordsWithLocators(body);
    const matrix = parsed.data
      .filter((values, index) => !(index >= locators.length && values.every((v) => !v)))
      .map((values, index) => ({
        values,
        ...(locators[index] ?? { raw: '', physicalRow: index + 1 }),
      }));
    return await parseMatrix(matrix, kind, options, {
      fileHash: await sha256(bytes),
      sheet: null,
      byteLength: bytes.byteLength,
    });
  } catch (error) {
    result.issues.push({
      code: 'IMPORT_BLOCKED',
      message: error instanceof Error ? error.message : 'Import failed.',
      severity: 'error',
    });
    return result;
  }
}
export async function parseMatrix<K extends SourceKind>(
  records: MatrixRecord[],
  kind: K,
  options: ParseOptions,
  source: { fileHash: string; sheet: string | null; byteLength: number; parserVersion?: string },
): Promise<ParseResult<RowByKind[K]>> {
  const result = empty<K>();
  try {
    if (
      !options.companyId?.trim() ||
      !options.bankAccountId?.trim() ||
      options.currency !== 'USD' ||
      !options.companyTimezone?.trim()
    )
      throw new Error('Explicit company, bank account, timezone and USD are required.');
    new Intl.DateTimeFormat('en-US', { timeZone: options.companyTimezone });
    for (const field of ['periodStart', 'periodEnd', 'asOfDate'] as const)
      parseDate(options[field], 'ISO');
    if (options.periodStart > options.periodEnd || options.asOfDate < options.periodEnd)
      throw new Error('Invalid report date range or observation cutoff.');
    if (!/^[0-9a-f]{64}$/.test(source.fileHash)) throw new Error('Invalid source hash.');
    if (
      source.byteLength > IMPORT_LIMITS.fileBytes ||
      source.byteLength + (options.existingTotalBytes ?? 0) > IMPORT_LIMITS.totalBytes
    )
      throw new Error('File exceeds size limit.');
    if (records.length > IMPORT_LIMITS.rows + 30)
      throw new Error('More than 20,000 data rows; narrow the report.');
    if (records.some((r) => r.values.length > IMPORT_LIMITS.columns))
      throw new Error('More than 80 columns.');
    if (
      records.some((r) =>
        r.values.some((v) => new TextEncoder().encode(v).byteLength > IMPORT_LIMITS.cellBytes),
      )
    )
      throw new Error('Cell exceeds 4 KB.');
    if (options.seenFileHashes?.includes(source.fileHash)) {
      result.ok = true;
      result.duplicate = true;
      result.issues.push({
        code: 'DUPLICATE_IMPORT',
        message: 'Identical file already imported; no rows added.',
        severity: 'warning',
      });
      return result;
    }
    let headerIndex =
      options.headerRow === undefined
        ? -1
        : records.findIndex((r) => r.physicalRow === options.headerRow);
    if (options.headerRow !== undefined && headerIndex < 0)
      throw new Error('Selected header row does not exist.');
    if (headerIndex < 0) {
      const candidates = records
        .slice(0, 30)
        .map((r, index) => {
          const m = mapHeaders(r.values, kind, options.bindings, options.excludedTargets);
          return {
            index,
            score:
              requiredFields[kind].filter((f) => m.bindings[f] !== undefined).length * 10 +
              Object.keys(m.bindings).length,
            signature: r.values.map(normalizeHeader).join('|'),
          };
        })
        .sort((a, b) => b.score - a.score);
      if (!candidates[0]?.score)
        throw new Error(
          'No recognized header found in the first 30 rows. Select the header and map required columns manually.',
        );
      const best = candidates.filter((c) => c.score === candidates[0].score);
      if (new Set(best.map((c) => c.signature)).size > 1)
        throw new Error('Ambiguous header rows. Select the correct header explicitly.');
      headerIndex = Math.min(...best.map((c) => c.index));
    }
    const headers = records[headerIndex].values,
      mapping = mapHeaders(headers, kind, options.bindings, options.excludedTargets);
    result.mapping = {
      headers,
      bindings: mapping.bindings,
      headerRow: records[headerIndex].physicalRow,
    };
    if (mapping.ambiguities.length) throw new Error(mapping.ambiguities.join(' '));
    const missing = requiredFields[kind].filter((f) => mapping.bindings[f] === undefined);
    if (missing.length)
      throw new Error(
        `Missing required meanings: ${missing.join(', ')}. Invoice totals and running balances are not payment amounts.`,
      );
    if (!options.dateFormat && options.profile !== 'synthetic-v1' && source.sheet === null)
      throw new Error('Choose the date convention explicitly (US MDY or ISO).');
    const excluded = result.controls.excludedRows;
    records
      .slice(0, headerIndex)
      .forEach((r) => excluded.push({ physicalRow: r.physicalRow, reason: 'Report preamble' }));
    const data = records.slice(headerIndex + 1).filter((r) => {
      const fields = r.values.filter((v) => v.trim());
      let reason =
        fields.length === 0
          ? 'Blank row'
          : r.values.length === headers.length &&
              r.values.every((v, i) => normalizeHeader(v) === normalizeHeader(headers[i]))
            ? 'Repeated header'
            : isReportSummary(r.values, mapping.bindings)
              ? 'Report summary/control row, not a posting atom'
              : '';
      if (reason) {
        excluded.push({ physicalRow: r.physicalRow, reason });
        return false;
      }
      return true;
    });
    if (data.length > IMPORT_LIMITS.rows) throw new Error('More than 20,000 data rows.');
    const mappingVersion = `local-alias-1.0:${await sha256(canonicalJson({ kind, bindings: mapping.bindings, excludedTargets: [...(options.excludedTargets ?? [])].sort(), profile: options.profile ?? 'manual', dateFormat: options.dateFormat ?? 'MDY', rowGrain: options.rowGrain ?? null, exportMode: options.exportMode ?? null, postedLedgerConfirmed: options.postedLedgerConfirmed ?? null, bankPostedConfirmed: options.bankPostedConfirmed ?? null, bankSignConvention: options.bankSignConvention ?? null, accountMap: options.accountMap ?? null }))}`;
    const normalized: AnyRow[] = [];
    for (let i = 0; i < data.length; i += 100) {
      await Promise.all(
        data.slice(i, i + 100).map(async (r) => {
          try {
            if (r.values.length !== headers.length)
              throw new Error(`Row has ${r.values.length} cells; expected ${headers.length}.`);
            const column_indices = Object.fromEntries(
              Object.entries(mapping.bindings).map(([field, column]) => [field, [column]]),
            );
            const provenance = {
              file_sha256: source.fileHash,
              sheet: source.sheet,
              physical_row: r.physicalRow,
              column_indices,
              raw_row_sha256: await sha256(r.raw),
              parser_version: source.parserVersion ?? 'csv-local-1.0',
              mapping_version: mappingVersion,
            };
            normalized.push(
              await normalizeRow(r.values, kind, mapping.bindings, options, provenance),
            );
          } catch (error) {
            result.issues.push({
              code: 'ROW_INVALID',
              message: error instanceof Error ? error.message : 'Invalid row.',
              severity: 'error',
              physicalRow: r.physicalRow,
            });
          }
        }),
      );
    }
    normalized.sort((a, b) => a.source_refs[0].physical_row - b.source_refs[0].physical_row);
    const rows = result.issues.some((i) => i.severity === 'error')
      ? []
      : await normalizeGrain(normalized, kind);
    const accounts =
      kind === 'QBO' || kind === 'QBD'
        ? [...new Set(rows.map((r) => (r as RowByKind['QBO']).account_full_name))]
        : [];
    const balances =
      options.accountBalances ??
      accounts.map((account_full_name) => ({
        account_id: null,
        account_full_name,
        opening_debit_balance_cents: null,
        closing_debit_balance_cents: null,
        coverage_confirmed: false,
      }));
    for (const balance of balances) {
      if (!balance.account_full_name || typeof balance.coverage_confirmed !== 'boolean')
        throw new Error('Invalid account control metadata.');
      for (const amount of [
        balance.opening_debit_balance_cents,
        balance.closing_debit_balance_cents,
      ])
        if (amount !== null && (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_CENTS))
          throw new Error('Account control balances must be known integer cents or null.');
    }
    const manifest: ImportManifest = {
      company_id: options.companyId,
      source_system: kind === 'COMPONENT' ? 'RECEIPT' : (kind as SourceSystem),
      source_file_sha256: source.fileHash,
      report_name: options.fileName ?? `${kind} local file`,
      report_grain:
        kind === 'ST'
          ? [...new Set((rows as RowByKind['ST'][]).map((r) => r.row_grain))].join(',')
          : kind === 'QBO' || kind === 'QBD'
            ? 'POSTING_LINE'
            : kind === 'BANK'
              ? 'BANK_TRANSACTION'
              : 'EVIDENCE',
      period_start: options.periodStart,
      period_end: options.periodEnd,
      as_of_date: options.asOfDate,
      company_timezone: options.companyTimezone,
      basis: options.basis ?? (kind === 'QBO' || kind === 'QBD' ? 'UNKNOWN' : 'NOT_APPLICABLE'),
      accounts,
      account_balances: balances,
      header_row: records[headerIndex].physicalRow,
      raw_row_count: records.slice(headerIndex + 1).filter((r) => r.values.some((v) => v.trim()))
        .length,
      normalized_row_count: rows.length,
      excluded_summary_rows: excluded.map((r) => r.physicalRow),
      opening_debit_balance_cents:
        balances.length === 1 ? balances[0].opening_debit_balance_cents : null,
      closing_debit_balance_cents:
        balances.length === 1 ? balances[0].closing_debit_balance_cents : null,
      coverage_confirmed: options.coverageConfirmed === true,
      missing_required_fields: missing,
    };
    result.manifest = manifest;
    result.controls.signedCents = checkedSum(
      rows.map((r) =>
        'signed_cents' in r
          ? r.signed_cents
          : 'gross_cents' in r
            ? r.gross_cents
            : 'amount_cents' in r
              ? r.amount_cents
              : 0,
      ),
    );
    if (kind === 'QBO' || kind === 'QBD') {
      result.controls.debitCents = checkedSum(
        (rows as RowByKind['QBO'][]).map((r) => r.debit_cents),
      );
      result.controls.creditCents = checkedSum(
        (rows as RowByKind['QBO'][]).map((r) => r.credit_cents),
      );
      for (const balance of balances) {
        const activity = checkedSum(
          (rows as RowByKind['QBO'][])
            .filter((r) => r.account_full_name === balance.account_full_name)
            .map((r) => r.signed_cents),
        );
        if (
          balance.opening_debit_balance_cents !== null &&
          balance.closing_debit_balance_cents !== null &&
          balance.opening_debit_balance_cents + activity !== balance.closing_debit_balance_cents
        )
          throw new Error(`Account control mismatch: ${balance.account_full_name}.`);
      }
    }
    result.ok = !result.issues.some((i) => i.severity === 'error');
    result.rows = result.ok ? (rows as RowByKind[K][]) : [];
    if (!manifest.coverage_confirmed)
      result.issues.push({
        code: 'COVERAGE_UNKNOWN',
        message:
          'Coverage not confirmed. Results are activity reconciliation, not a verified month-end close.',
        severity: 'warning',
      });
    return result;
  } catch (error) {
    result.ok = false;
    result.rows = [];
    result.issues.push({
      code: 'IMPORT_BLOCKED',
      message: error instanceof Error ? error.message : 'Import failed.',
      severity: 'error',
    });
    return result;
  }
}
export function decodeCsv(
  bytes: Uint8Array,
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' = 'utf-8',
): string {
  if (bytes.byteLength > IMPORT_LIMITS.fileBytes) throw new Error('File exceeds 10 MB.');
  if (
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) &&
    encoding === 'utf-8'
  )
    throw new Error('UTF-16 detected. Choose the matching encoding explicitly.');
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}
