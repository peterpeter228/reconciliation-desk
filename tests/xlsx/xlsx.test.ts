import { describe, it, expect } from 'vitest';
import { utils, write, type WorkBook, type WorkSheet } from 'xlsx';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import {
  inspectXlsx,
  readXlsxMatrix,
  parseXlsx,
  excelSerialToISO,
  XLSX_LIMITS,
  XlsxImportError,
  type XlsxOptions,
} from '../../src/ingestion/xlsx';
import { sha256 } from '../../src/ingestion/primitives';
const options: XlsxOptions = {
  companyId: 'CO',
  bankAccountId: 'BANK',
  companyTimezone: 'America/Los_Angeles',
  currency: 'USD',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  asOfDate: '2026-09-30',
  bankPostedConfirmed: true,
  bankSignConvention: 'INFLOW_POSITIVE',
  fileName: 'bank.xlsx',
};
function workbook(
  sheets: Record<string, WorkSheet> = {
    Data: utils.aoa_to_sheet([
      ['Date', 'Amount'],
      ['2026-09-01', 12.34],
    ]),
  },
  date1904 = false,
): Uint8Array {
  const book = utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) utils.book_append_sheet(book, sheet, name);
  book.Workbook = { WBProps: { date1904 } };
  return bytes(book);
}
function bytes(book: WorkBook): Uint8Array {
  return new Uint8Array(write(book, { bookType: 'xlsx', type: 'array', compression: true }));
}
function edit(
  bytes: Uint8Array,
  fn: (parts: Record<string, Uint8Array>) => void,
  level: 0 | 6 = 0,
): Uint8Array {
  const parts = unzipSync(bytes);
  fn(parts);
  return zipSync(parts, { level });
}
function xmlEdit(bytes: Uint8Array, path: string, fn: (xml: string) => string): Uint8Array {
  return edit(bytes, (p) => {
    p[path] = strToU8(fn(strFromU8(p[path])));
  });
}
function fails(bytes: Uint8Array, code?: string) {
  try {
    inspectXlsx(bytes);
    throw new Error('Should reject');
  } catch (e) {
    expect(e).toBeInstanceOf(XlsxImportError);
    if (code) expect((e as XlsxImportError).code).toBe(code);
  }
}
const sheetPath = 'xl/worksheets/sheet1.xml';

describe('values-only XLSX import', () => {
  it('parses amounts without display rounding and preserves original byte/row provenance', async () => {
    const sheet = utils.aoa_to_sheet([
      ['Monthly bank report'],
      [],
      ['Date', 'Amount'],
      ['2026-09-01', 12.34],
      [],
      ['2026-09-02', -4.56],
    ]);
    sheet.B4.z = '$0.0';
    const input = workbook({ Data: sheet }),
      result = await parseXlsx(input, 'BANK', options);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.rows.map((r) => r.signed_cents)).toEqual([1234, -456]);
    expect(result.rows.map((r) => r.source_refs[0].physical_row)).toEqual([4, 6]);
    expect(result.rows[0].source_refs[0].sheet).toBe('Data');
    expect(result.rows[0].source_refs[0].file_sha256).toBe(await sha256(input));
    expect(result.rows[0].source_refs[0].raw_row_sha256).toMatch(/^[a-f\d]{64}$/);
    expect(result.manifest?.source_file_sha256).toBe(await sha256(input));
  });
  it('accepts standard shared strings without losing text values', async () => {
    const book = utils.book_new();
    utils.book_append_sheet(
      book,
      utils.aoa_to_sheet([
        ['Date', 'Amount', 'Description'],
        ['2026-09-01', 4.25, 'ACH & café'],
      ]),
      'Data',
    );
    const input = new Uint8Array(write(book, { type: 'array', bookType: 'xlsx', bookSST: true }));
    const result = await parseXlsx(input, 'BANK', options);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.rows[0].description_local).toBe('ACH & café');
  });
  it('keeps a primitive row hash deterministic', async () => {
    const input = workbook(),
      a = await readXlsxMatrix(input),
      b = await readXlsxMatrix(input);
    expect(a.records).toEqual(b.records);
    expect(a.records[1].physicalRow).toBe(2);
  });
  it('requires explicit multi-sheet selection instead of merging or selecting first', async () => {
    const s = utils.aoa_to_sheet([
        ['Date', 'Amount'],
        ['2026-09-01', 2],
      ]),
      input = workbook({ First: s, Second: s });
    expect(inspectXlsx(input).requiresSheetSelection).toBe(true);
    expect((await parseXlsx(input, 'BANK', options)).issues[0].code).toBe('XLSX_SHEET_SELECTION');
    const result = await parseXlsx(input, 'BANK', { ...options, sheetName: 'Second' });
    expect(result.ok).toBe(true);
    expect(result.rows[0].source_refs[0].sheet).toBe('Second');
    expect((await parseXlsx(input, 'BANK', { ...options, sheetName: 'Missing' })).ok).toBe(false);
  });
  it('does not silently choose the sole hidden sheet', async () => {
    const book = utils.book_new();
    utils.book_append_sheet(
      book,
      utils.aoa_to_sheet([
        ['Date', 'Amount'],
        ['2026-09-01', 1],
      ]),
      'Hidden',
    );
    book.Workbook = { Sheets: [{ Hidden: 1, name: 'Hidden' }] };
    const result = await parseXlsx(bytes(book), 'BANK', options);
    expect(result.issues[0].code).toBe('XLSX_SHEET_SELECTION');
  });
  it('rejects more than five sheets', () => {
    const s = utils.aoa_to_sheet([[1]]);
    fails(
      workbook(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`S${i}`, s]))),
      'XLSX_SHEET_LIMIT',
    );
  });
  it('handles duplicate file hashes through the shared matrix adapter', async () => {
    const input = workbook();
    const result = await parseXlsx(input, 'BANK', {
      ...options,
      seenFileHashes: [await sha256(input)],
    });
    expect(result.ok).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(result.rows).toEqual([]);
  });
  it('rejects wrong extension and non-XLSX containers', async () => {
    expect(
      (await parseXlsx(workbook(), 'BANK', { ...options, fileName: 'macro.xlsm' })).issues[0].code,
    ).toBe('XLSX_FORMAT');
    fails(strToU8('encrypted OLE workbook'));
  });
  it('rejects error cells and does not round a third fractional digit into valid money', async () => {
    const s = utils.aoa_to_sheet([
      ['Date', 'Amount'],
      ['2026-09-01', 12.345],
    ]);
    expect((await parseXlsx(workbook({ Data: s }), 'BANK', options)).ok).toBe(false);
    s.B2 = { t: 'e', v: 7 };
    expect((await parseXlsx(workbook({ Data: s }), 'BANK', options)).issues[0].code).toBe(
      'XLSX_CELL_ERROR',
    );
  });
});
describe('Excel dates without timezone drift', () => {
  it('uses both workbook epochs and the 1900 leap-day correction', () => {
    expect(excelSerialToISO(1)).toBe('1900-01-01');
    expect(excelSerialToISO(59)).toBe('1900-02-28');
    expect(excelSerialToISO(61)).toBe('1900-03-01');
    expect(excelSerialToISO(0, true)).toBe('1904-01-01');
    expect(excelSerialToISO(1, true)).toBe('1904-01-02');
    expect(excelSerialToISO(1462)).toBe(excelSerialToISO(0, true));
    expect(() => excelSerialToISO(60)).toThrow(/nonexistent/);
  });
  it.each([false, true])(
    'converts style-qualified calendar cells with date1904=%s',
    async (date1904) => {
      const s = utils.aoa_to_sheet([
        ['Date', 'Amount'],
        [date1904 ? 44804 : 46266, 12.34],
      ]);
      s.A2.z = 'mm/dd/yyyy';
      const matrix = await readXlsxMatrix(workbook({ Data: s }, date1904));
      expect(matrix.records[1].values[0]).toBe('2026-09-01');
    },
  );
  it('does not guess a date from an unstyled number', async () => {
    const s = utils.aoa_to_sheet([
      ['Date', 'Amount'],
      [46266, 12.34],
    ]);
    expect((await parseXlsx(workbook({ Data: s }), 'BANK', options)).ok).toBe(false);
  });
  it('uses calendar day rather than timezone shifts for fractional serials', () => {
    const old = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        expect(excelSerialToISO(46266.99)).toBe('2026-09-01');
      }
    } finally {
      process.env.TZ = old;
    }
  });
  it('rejects ambiguous or invalid workbook date epochs', () => {
    fails(
      xmlEdit(workbook(), 'xl/workbook.xml', (x) =>
        x.replace('<workbookPr ', '<workbookPr date1904="banana" '),
      ),
      'XLSX_DATE',
    );
  });
  it('rejects impossible, out-of-range and time-only dates', async () => {
    for (const s of [NaN, Infinity, -1, 60, 10_000_000])
      expect(() => excelSerialToISO(s)).toThrow();
    const sheet = utils.aoa_to_sheet([
      ['Date', 'Amount'],
      [0.5, 1],
    ]);
    sheet.A2.z = 'hh:mm';
    expect((await parseXlsx(workbook({ Data: sheet }), 'BANK', options)).issues[0].code).toBe(
      'XLSX_DATE',
    );
  });
});
describe('active workbook content rejection', () => {
  it('rejects formulas with cached results anywhere, including unused sheets', () => {
    const a = utils.aoa_to_sheet([
        ['Date', 'Amount'],
        ['2026-09-01', 12.34],
      ]),
      b = utils.aoa_to_sheet([[1]]);
    b.A1 = { t: 'n', v: 1, f: '1+0' };
    fails(workbook({ Data: a, Unused: b }), 'XLSX_FORMULA');
  });
  it('rejects shared formula and namespace-prefixed formula elements', () => {
    for (const formula of [
      '<f t="shared" si="0"/>',
      '<x:f xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">1+1</x:f>',
    ])
      fails(
        xmlEdit(workbook(), sheetPath, (x) => x.replace('<v>12.34</v>', formula + '<v>12.34</v>')),
        'XLSX_FORMULA',
      );
  });
  it('rejects macros even in a renamed .xlsx', () => {
    fails(
      edit(workbook(), (p) => {
        p['xl/vbaProject.bin'] = new Uint8Array([0]);
      }),
      'XLSX_ACTIVE_CONTENT',
    );
    fails(
      xmlEdit(workbook(), '[Content_Types].xml', (x) =>
        x.replace('spreadsheetml.sheet.main+xml', 'ms-excel.sheet.macroEnabled.main+xml'),
      ),
      'XLSX_ACTIVE_CONTENT',
    );
  });
  it('rejects external relationships including encoded TargetMode', () => {
    for (const mode of ['External', '&#69;xternal'])
      fails(
        xmlEdit(workbook(), 'xl/_rels/workbook.xml.rels', (x) =>
          x.replace(
            '</Relationships>',
            `<Relationship Id="bad" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test" TargetMode="${mode}"/></Relationships>`,
          ),
        ),
        'XLSX_EXTERNAL_LINK',
      );
  });
  it('rejects external-link parts, DDE names and data connections', () => {
    fails(
      edit(workbook(), (p) => {
        p['xl/externalLinks/externalLink1.xml'] = strToU8('<externalLink/>');
      }),
      'XLSX_ACTIVE_CONTENT',
    );
    fails(
      xmlEdit(workbook(), 'xl/workbook.xml', (x) =>
        x.replace(
          '</workbook>',
          '<definedNames><definedName name="x">DDE</definedName></definedNames></workbook>',
        ),
      ),
      'XLSX_FORMULA',
    );
  });
  it('rejects disguised tags inside malformed XML declarations', () => {
    fails(
      xmlEdit(workbook(), sheetPath, (x) =>
        x.replace(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<?xml version="1.0" fake="<f>1+1</f>"?>',
        ),
      ),
      'XLSX_XML_UNSUPPORTED',
    );
  });
  it('rejects XML entity expansion and malformed XML before SheetJS', () => {
    fails(
      xmlEdit(workbook(), sheetPath, (x) =>
        x.replace('<worksheet', '<!DOCTYPE worksheet [<!ENTITY bomb "x">]><worksheet'),
      ),
      'XLSX_XML_UNSUPPORTED',
    );
    fails(
      xmlEdit(workbook(), sheetPath, (x) => x.replace('</row>', '</wrong>')),
      'XLSX_XML_INVALID',
    );
  });
  it('accepts safe escaped customer text without interpreting it as markup', async () => {
    const s = utils.aoa_to_sheet([
      ['Date', 'Amount', 'Description'],
      ['2026-09-01', 1, '<f>NOT A FORMULA</f> & café'],
    ]);
    const result = await parseXlsx(workbook({ Data: s }), 'BANK', options);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.rows[0].description_local).toBe('<f>NOT A FORMULA</f> & café');
  });
});
describe('archive and allocation budgets', () => {
  it('rejects a file over 10 MB and a workspace over 30 MB', async () => {
    fails(new Uint8Array(XLSX_LIMITS.fileBytes + 1), 'XLSX_FILE_LIMIT');
    expect(
      (await parseXlsx(workbook(), 'BANK', { ...options, existingTotalBytes: 30 * 1024 * 1024 }))
        .issues[0].code,
    ).toBe('XLSX_WORKSPACE_LIMIT');
  });
  it('rejects high-ratio deflate bombs from metadata before inflate', () => {
    fails(
      edit(
        workbook(),
        (p) => {
          p['docProps/bomb.xml'] = strToU8('<a>' + 'A'.repeat(200_000) + '</a>');
        },
        6,
      ),
      'XLSX_ZIP_LIMIT',
    );
  });
  it('rejects inflated data larger than forged declarations', () => {
    const b = zipSync({ 'a.xml': strToU8('<a>' + 'A'.repeat(12000) + '</a>') }, { level: 6 });
    const v = new DataView(b.buffer);
    const e = b.length - 22,
      c = v.getUint32(e + 16, true);
    v.setUint32(22, 10, true);
    v.setUint32(c + 24, 10, true);
    fails(b, 'XLSX_ZIP_LIMIT');
  });
  it('rejects total and per-part expanded limits before decompression', () => {
    const b = workbook(),
      v = new DataView(b.buffer),
      c = v.getUint32(b.length - 22 + 16, true),
      local = v.getUint32(c + 42, true);
    v.setUint32(c + 24, XLSX_LIMITS.partBytes + 1, true);
    v.setUint32(local + 22, XLSX_LIMITS.partBytes + 1, true);
    fails(b, 'XLSX_ZIP_LIMIT');
  });
  it('enforces the combined expanded-byte budget before any invalid body is inflated', () => {
    const b = zipSync(
      {
        'a.xml': new Uint8Array(200000),
        'b.xml': new Uint8Array(200000),
        'c.xml': new Uint8Array(200000),
      },
      { level: 0 },
    );
    const v = new DataView(b.buffer);
    let c = v.getUint32(b.length - 22 + 16, true);
    for (let i = 0; i < 3; i++) {
      const local = v.getUint32(c + 42, true);
      v.setUint16(c + 10, 8, true);
      v.setUint16(local + 8, 8, true);
      v.setUint32(c + 24, 15 * 1024 * 1024, true);
      v.setUint32(local + 22, 15 * 1024 * 1024, true);
      c += 46 + v.getUint16(c + 28, true) + v.getUint16(c + 30, true) + v.getUint16(c + 32, true);
    }
    fails(b, 'XLSX_ZIP_LIMIT');
  });
  it('rejects encrypted flags and ZIP64 markers', () => {
    for (const flag of [1, 64, 8192]) {
      const b = workbook(),
        v = new DataView(b.buffer),
        c = v.getUint32(b.length - 22 + 16, true);
      v.setUint16(c + 8, v.getUint16(c + 8, true) | flag, true);
      fails(b, 'XLSX_ENCRYPTED');
    }
    const b = workbook(),
      v = new DataView(b.buffer);
    v.setUint16(b.length - 22 + 10, 65535, true);
    fails(b, 'XLSX_ZIP_UNSUPPORTED');
  });
  it('rejects local/central mismatch, checksum corruption, and trailing data', () => {
    let b = workbook();
    b[30] ^= 1;
    fails(b, 'XLSX_ZIP_INVALID');
    b = edit(workbook(), () => {});
    const v = new DataView(b.buffer),
      c = v.getUint32(b.length - 22 + 16, true),
      local = v.getUint32(c + 42, true);
    b[local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true) + 10] ^= 1;
    fails(b, 'XLSX_ZIP_INVALID');
    const t = new Uint8Array(workbook().length + 1);
    t.set(workbook());
    fails(t, 'XLSX_ZIP_INVALID');
  });
  it('rejects unsafe ZIP paths and unlisted local records', () => {
    fails(
      edit(workbook(), (p) => {
        p['../outside.xml'] = strToU8('<x/>');
      }),
      'XLSX_ZIP_PATH',
    );
    const b = workbook(),
      p = new Uint8Array(b.length + 1);
    p.set(b, 1);
    fails(p, 'XLSX_FORMAT');
  });
  it('rejects excessive worksheet dimensions and out-of-order/duplicate cells', () => {
    for (const address of ['CC1', 'A20031', 'XFD1048576'])
      fails(
        xmlEdit(workbook(), sheetPath, (x) => x.replace('A1:B2', `A1:${address}`)),
        'XLSX_RANGE_LIMIT',
      );
    fails(
      xmlEdit(workbook(), sheetPath, (x) => x.replace('r="B2"', 'r="A2"')),
      'XLSX_RANGE',
    );
  });
  it('rejects oversized cells and shared strings before SheetJS', () => {
    const s = utils.aoa_to_sheet([
      ['Date', 'Amount', 'Description'],
      ['2026-09-01', 1, '中'.repeat(1366)],
    ]);
    fails(workbook({ Data: s }), 'XLSX_CELL_LIMIT');
  });
  it('checks worksheet ranges even when relationships point to a nonstandard XML path', () => {
    const b = edit(workbook(), (p) => {
      p['docProps/redirect.xml'] = strToU8(
        strFromU8(p[sheetPath]).replace('A1:B2', 'A1:XFD1048576'),
      );
    });
    fails(b, 'XLSX_RANGE_LIMIT');
  });
  it('rejects malformed numeric literals, precision loss and ambiguous attributes', () => {
    for (const value of ['12garbage', '9007199254740993', 'NaN', '1e999'])
      fails(
        xmlEdit(workbook(), sheetPath, (x) => x.replace('<v>12.34</v>', `<v>${value}</v>`)),
        'XLSX_NUMBER',
      );
    fails(
      xmlEdit(workbook(), sheetPath, (x) => x.replace('r="B2"', 'r="B2" x:r="XFD1048576"')),
      'XLSX_XML_INVALID',
    );
  });
  it('rejects ISO datetime cell timezone conversion before the library parses it', () => {
    fails(
      xmlEdit(workbook(), sheetPath, (x) =>
        x.replace(
          '<c r="B2"><v>12.34</v></c>',
          '<c r="B2" t="d"><v>2026-09-01T00:00:00+14:00</v></c>',
        ),
      ),
      'XLSX_DATE',
    );
  });
  it('strips XML comments before the regex-based library can interpret their fake cells', async () => {
    const b = xmlEdit(workbook(), sheetPath, (x) =>
      x.replace(
        '</sheetData>',
        '<!--<row r="1000000"><c r="A1000000"><f>1+1</f><v>2</v></c></row>--></sheetData>',
      ),
    );
    const result = await parseXlsx(b, 'BANK', options);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.rows).toHaveLength(1);
  });
  it('enforces the actual per-sheet cell budget, not just dimensions', () => {
    const b = edit(
      workbook(),
      (p) => {
        let body = '<worksheet><sheetData>';
        for (let r = 1; r <= 6251; r++) {
          body += `<row r="${r}">`;
          for (let c = 0; c < 80; c++) body += `<c r="${utils.encode_col(c)}${r}"><v>0</v></c>`;
          body += '</row>';
        }
        body += '</sheetData></worksheet>';
        p[sheetPath] = strToU8(body);
      },
      6,
    );
    fails(b, 'XLSX_CELL_LIMIT');
  });
  it('rejects excessive ZIP entries and XML nesting', () => {
    fails(
      edit(workbook(), (p) => {
        for (let i = 0; i < 260; i++) p[`docProps/x${i}.xml`] = strToU8('<a/>');
      }),
      'XLSX_ZIP_LIMIT',
    );
    fails(
      edit(workbook(), (p) => {
        p['docProps/nested.xml'] = strToU8('<a>'.repeat(65) + '</a>'.repeat(65));
      }),
      'XLSX_XML_LIMIT',
    );
  });
});
