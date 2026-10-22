import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { utils, write } from 'xlsx';
import { parseXlsx, inspectXlsx, readXlsxMatrix } from '../../src/ingestion/xlsx';
import { sha256 } from '../../src/ingestion/primitives';
import {
  nativeXlsxBytes,
  options,
  matrix,
  secondGroup,
} from '../qbo-roundtrip-adversarial/fixtures';

const opts = { ...options, sheetName: 'Sheet1' };
function changed(edit: (xml: string) => string) {
  const parts = unzipSync(nativeXlsxBytes);
  parts['xl/worksheets/sheet1.xml'] = strToU8(edit(strFromU8(parts['xl/worksheets/sheet1.xml'])));
  return zipSync(parts, { level: 0 });
}
function withTwoGroups(formula: boolean) {
  const rows = matrix();
  secondGroup(rows);
  const sheet = utils.aoa_to_sheet(rows);
  if (formula) sheet.H7 = { t: 'n', f: '900', v: 900 };
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, 'Sheet1');
  return new Uint8Array(write(book, { bookType: 'xlsx', type: 'array' }));
}
describe('native journal controls and complete-transaction isolation', () => {
  it('previews original formula-bearing report without altering its bytes', async () => {
    const before = await sha256(nativeXlsxBytes);
    expect(inspectXlsx(nativeXlsxBytes).sheets[0].rows).toBe(14);
    const parsed = await parseXlsx(nativeXlsxBytes, 'QBO', opts);
    expect(parsed.status).toBe('READY');
    expect(parsed.rows.map((r) => r.source_refs[0].physical_row)).toEqual([7, 8]);
    expect(
      parsed.controls.formulaCells?.map((c) => [
        c.address,
        c.cachedValue,
        c.independentCents,
        c.status,
      ]),
    ).toEqual([
      ['H9', 900, 90000, 'CONSISTENT'],
      ['I9', 900, 90000, 'CONSISTENT'],
      ['H10', 900, 90000, 'CONSISTENT'],
      ['I10', 900, 90000, 'CONSISTENT'],
    ]);
    expect(await sha256(nativeXlsxBytes)).toBe(before);
  });
  it('keeps valid detail preview when a formula cache is absent, without inventing zero', async () => {
    const bytes = changed((xml) => xml.replace('<f>H7+H8</f><v>900.0</v>', '<f>H7+H8</f>'));
    const parsed = await parseXlsx(bytes, 'QBO', opts);
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.status).toBe('PARTIAL');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.controls.formulaCells?.find((c) => c.address === 'H9')).toMatchObject({
      cachedValue: null,
      status: 'UNVERIFIED',
      independentCents: 90000,
    });
    expect(parsed.controls.accountingBlockedTransactionIds).toContain('145');
    expect(parsed.manifest?.missing_required_fields.length).toBeGreaterThan(0);
  });
  it('does not trust stale cached totals, even when grand total still matches', async () => {
    const bytes = changed((xml) =>
      xml.replace('<f>H7+H8</f><v>900.0</v>', '<f>H7+H8</f><v>901.0</v>'),
    );
    const parsed = await parseXlsx(bytes, 'QBO', opts);
    expect(parsed.status).toBe('PARTIAL');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.controls.formulaCells?.find((c) => c.address === 'H9')?.status).toBe('CONFLICT');
    expect(parsed.controls.accountingBlockedTransactionIds).toContain('145');
  });
  it('never evaluates a control formula, including a malicious formula text', async () => {
    const bytes = changed((xml) =>
      xml.replace('<f>H7+H8</f>', '<f>WEBSERVICE(&quot;https://invalid.test&quot;)</f>'),
    );
    const parsed = await parseXlsx(bytes, 'QBO', opts);
    expect(parsed.controls.formulaCells?.[0].formula).toContain('WEBSERVICE');
    expect(parsed.controls.formulaCells?.[0].independentCents).toBe(90000);
    // CONSISTENT only describes cache/detail arithmetic, never execution or freshness.
    expect(parsed.controls.formulaCells?.[0].status).toBe('CONSISTENT');
  });
  it('isolates both legs of a formula-dependent transaction while retaining another complete transaction', async () => {
    const parsed = await parseXlsx(withTwoGroups(true), 'QBO', opts);
    expect(parsed.status, JSON.stringify(parsed.issues)).toBe('PARTIAL');
    expect(parsed.rows.map((r) => r.transaction_id)).toEqual(['981', '981']);
    expect(parsed.controls.quarantinedGroups?.[0]).toMatchObject({
      transactionId: '145',
      physicalRows: [6, 7, 8, 9],
    });
    expect(parsed.controls.excludedRows.some((r) => r.physicalRow === 7)).toBe(false);
    expect(parsed.controls.formulaCells?.[0].status).toBe('TRANSACTION_FORMULA');
  });
  it('does not let native formula evidence flow through a generic profile', async () => {
    const parsed = await parseXlsx(nativeXlsxBytes, 'QBO', { ...opts, profile: 'manual' });
    expect(parsed.ok).toBe(false);
    expect(parsed.issues[0].code).toBe('XLSX_FORMULA');
    const preview = await readXlsxMatrix(nativeXlsxBytes, opts);
    expect(preview.records[8].formulaCells?.[0].formula).toBe('H7+H8');
  });
});
