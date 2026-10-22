import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { read, utils, write } from 'xlsx';
import { inspectXlsx, readXlsxMatrix, XlsxImportError } from '../../src/ingestion/xlsx';

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const strict = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
const x15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
const extensionId = '{140A7094-0E35-4892-8432-C4D2E57EDEB5}';
const workbookPath = 'xl/workbook.xml';
const sheetPath = 'xl/worksheets/sheet1.xml';
const nativePath = new URL(
  '../../evidence/quickbooks-acceptance-20261021/target-transaction-journal-145.xlsx',
  import.meta.url,
);
const nativeHash = 'ac1b896b3377199496c67132968e8e61949f388eaa7a13c43ed52fcace95e033';

function workbook(date1904 = false): Uint8Array {
  const book = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ['Date', 'Amount'],
    [date1904 ? 44833 : 46295, 900],
  ]);
  sheet.A2.z = 'mm/dd/yyyy';
  utils.book_append_sheet(book, sheet, 'Data');
  book.Workbook = { WBProps: { date1904 } };
  return new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' }));
}

function edit(input: Uint8Array, change: (xml: string) => string, path = workbookPath): Uint8Array {
  const parts = unzipSync(input);
  parts[path] = strToU8(change(strFromU8(parts[path])));
  return zipSync(parts, { level: 0 });
}

function extension(node = `<x15:workbookPr xmlns:x15="${x15}" chartTrackingRefBase="1"/>`): string {
  return `<extLst><ext uri="${extensionId}">${node}</ext></extLst>`;
}

function withExtension(input = workbook(), fragment = extension()): Uint8Array {
  return edit(input, (xml) => xml.replace('</workbook>', `${fragment}</workbook>`));
}

function blocked(input: Uint8Array, code: string): void {
  let error: unknown;
  try {
    inspectXlsx(input);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(XlsxImportError);
  expect((error as XlsxImportError).code).toBe(code);
}

describe('QBO workbook property namespace compatibility', () => {
  it.each([false, true])(
    'keeps the standard epoch with x15 chart metadata (%s)',
    async (date1904) => {
      const input = withExtension(workbook(date1904));
      const matrix = await readXlsxMatrix(input);
      expect(matrix.inspection.date1904).toBe(date1904);
      expect(matrix.records[1].values).toEqual(['2026-09-30', '900']);
      expect(matrix.records[1].physicalRow).toBe(2);
      expect(matrix.source.parserVersion).toBe('xlsx-local-1.3/sheetjs-0.20.3');
    },
  );

  it.each(['1', '0', 'true', 'false'])(
    'accepts only boolean chartTrackingRefBase metadata: %s',
    (value) => {
      const input = withExtension(
        workbook(),
        extension(`<x15:workbookPr xmlns:x15="${x15}" chartTrackingRefBase="${value}"/>`),
      );
      expect(inspectXlsx(input).date1904).toBe(false);
    },
  );

  it.each([main, strict])(
    'resolves standard workbook prefixes by namespace: %s',
    async (namespace) => {
      const input = edit(withExtension(workbook(true)), (xml) =>
        xml
          .replace(`xmlns="${main}"`, `xmlns="${namespace}" xmlns:s="${namespace}"`)
          .replace('<workbookPr ', '<s:workbookPr '),
      );
      expect((await readXlsxMatrix(input)).records[1].values[0]).toBe('2026-09-30');
    },
  );

  it('resolves an alternate extension prefix inherited from its parent', () => {
    const input = withExtension(
      workbook(),
      `<extLst><ext uri="${extensionId}" xmlns:charts="${x15}"><charts:workbookPr chartTrackingRefBase="1"/></ext></extLst>`,
    );
    expect(inspectXlsx(input).date1904).toBe(false);
  });

  it('resolves a local default extension namespace without reclassifying siblings', () => {
    const input = withExtension(
      workbook(true),
      extension(`<workbookPr xmlns="${x15}" chartTrackingRefBase="1"></workbookPr>`),
    );
    expect(inspectXlsx(input).date1904).toBe(true);
  });

  it('defaults to the 1900 epoch when standard workbookPr has no date1904', () => {
    const input = edit(withExtension(), (xml) => xml.replace(/ date1904="[^"]*"/, ''));
    expect(inspectXlsx(input).date1904).toBe(false);
  });

  it('does not retain a child prefix rebinding for a sibling extension', () => {
    const input = withExtension(
      workbook(),
      `<extLst xmlns:charts="${x15}"><ext uri="${extensionId}"><charts:workbookPr chartTrackingRefBase="1"/><unused xmlns:charts="urn:spoof"/><charts:workbookPr chartTrackingRefBase="0"/></ext></extLst>`,
    );
    expect(inspectXlsx(input).date1904).toBe(false);
  });
});

describe('workbook epoch and namespace spoofing rejection', () => {
  it.each([
    '<workbookPr date1904="0"/>',
    `<s:workbookPr xmlns:s="${main}" date1904="0"/>`,
    `<x15:workbookPr xmlns:x15="${main}" date1904="0"/>`,
  ])('rejects a second standard workbookPr regardless of prefix: %s', (node) => {
    blocked(withExtension(workbook(), node), 'XLSX_DATE');
  });

  it('rejects a standard workbookPr concealed under an extension', () => {
    blocked(
      withExtension(workbook(), extension(`<x15:workbookPr xmlns:x15="${main}"/>`)),
      'XLSX_DATE',
    );
  });

  it.each(['banana', 'TRUE', '2', '-1', '', ' true '])('rejects invalid date1904=%s', (value) => {
    const input = edit(withExtension(), (xml) =>
      xml.replace(/<workbookPr\b[^>]*\/>/, `<workbookPr date1904="${value}"/>`),
    );
    blocked(input, 'XLSX_DATE');
  });

  it.each(['p:date1904', 'date1904_shadow', 'DATE1904', 'Date1904'])(
    'rejects date1904 attribute alias %s before SheetJS',
    (attribute) => {
      const input = edit(withExtension(), (xml) =>
        xml.replace(/<workbookPr\b[^>]*\/>/, `<workbookPr xmlns:p="${main}" ${attribute}="1"/>`),
      );
      blocked(input, 'XLSX_XML_UNSUPPORTED');
    },
  );

  it('rejects encoded date1904 and duplicate date attributes', () => {
    blocked(
      edit(withExtension(), (xml) =>
        xml.replace(/<workbookPr\b[^>]*\/>/, '<workbookPr date1904="&#49;"/>'),
      ),
      'XLSX_XML_UNSUPPORTED',
    );
    blocked(
      edit(withExtension(), (xml) =>
        xml.replace(/<workbookPr\b[^>]*\/>/, '<workbookPr date1904="0" date1904="1"/>'),
      ),
      'XLSX_XML_INVALID',
    );
  });

  it.each([
    '<x15:workbookPr chartTrackingRefBase="1"/>',
    '<x15:workbookPr xmlns:x15="urn:spoof" chartTrackingRefBase="1"/>',
    '<workbookPr xmlns="urn:spoof" chartTrackingRefBase="1"/>',
    '<workbookPr xmlns="" chartTrackingRefBase="1"/>',
    `<x15:workbookpr xmlns:x15="${x15}"/>`,
  ])('rejects unresolved, wrong, empty or noncanonical extension namespaces: %s', (node) => {
    blocked(withExtension(workbook(), extension(node)), 'XLSX_XML_UNSUPPORTED');
  });

  it.each([
    `<xml:workbookPr xmlns:xml="${x15}"/>`,
    `<xmlns:workbookPr xmlns:xmlns="${x15}"/>`,
    `<x15:workbookPr xmlns:x15="${x15}" xmlns:reserved="http://www.w3.org/XML/1998/namespace"/>`,
    `<x15:workbookPr xmlns:x15="${x15}" xmlns:reserved="http://www.w3.org/2000/xmlns/"/>`,
    `<x15:workbookPr xmlns:x15="${x15}" xmlns:unused=""/>`,
  ])('rejects reserved or invalid prefix declarations: %s', (node) => {
    blocked(withExtension(workbook(), extension(node)), 'XLSX_XML_UNSUPPORTED');
  });

  it('rejects an extension prefix rebound at the node rather than trusting its ancestor', () => {
    const input = withExtension(
      workbook(),
      `<extLst xmlns:x15="${x15}"><ext uri="${extensionId}"><x15:workbookPr xmlns:x15="urn:spoof" chartTrackingRefBase="1"/></ext></extLst>`,
    );
    blocked(input, 'XLSX_XML_UNSUPPORTED');
  });

  it.each([
    `date1904="1"`,
    `p:date1904="1"`,
    `date1904_shadow="1"`,
    `chartTrackingRefBase="banana"`,
    `p:chartTrackingRefBase="1"`,
    `chartTrackingRefBase_shadow="1"`,
    `codeName="Unexpected"`,
  ])('rejects unsupported extension attributes: %s', (attributes) => {
    blocked(
      withExtension(
        workbook(),
        extension(`<x15:workbookPr xmlns:x15="${x15}" xmlns:p="${x15}" ${attributes}/>`),
      ),
      'XLSX_XML_UNSUPPORTED',
    );
  });

  it('demonstrates why an unrestricted x15 date1904 would be unsafe for the parser epoch', () => {
    const input = withExtension(
      workbook(false),
      extension(`<x15:workbookPr xmlns:x15="${x15}" date1904="1"/>`),
    );
    expect(read(input, { type: 'array' }).Workbook?.WBProps?.date1904).toBe(true);
    blocked(input, 'XLSX_XML_UNSUPPORTED');
  });

  it.each([
    `<x15:workbookPr xmlns:x15="${x15}"/>`,
    `<extLst><ext uri="unexpected"><x15:workbookPr xmlns:x15="${x15}"/></ext></extLst>`,
    `<extLst xmlns="urn:spoof"><ext uri="${extensionId}"><x15:workbookPr xmlns:x15="${x15}"/></ext></extLst>`,
    `<extLst><ext uri="${extensionId}" xmlns="urn:spoof"><x15:workbookPr xmlns:x15="${x15}"/></ext></extLst>`,
    extension(`<x15:workbookPr xmlns:x15="${x15}"><unknown/></x15:workbookPr>`),
    extension(`<x15:workbookPr xmlns:x15="${x15}">unexpected text</x15:workbookPr>`),
  ])('rejects out-of-profile extension context or content: %s', (fragment) => {
    blocked(withExtension(workbook(), fragment), 'XLSX_XML_UNSUPPORTED');
  });

  it('rejects workbookPr under a nonstandard workbook root', () => {
    blocked(
      edit(workbook(), (xml) =>
        xml
          .replace(`xmlns="${main}"`, 'xmlns="urn:spoof"')
          .replace('<workbookPr ', `<workbookPr xmlns="${main}" `),
      ),
      'XLSX_DATE',
    );
  });
});

describe('native QBO evidence and values-only boundary', () => {
  it('preserves full report physical rows in an independently generated values-only fixture', async () => {
    // Deliberately a new synthetic workbook from the companion CSV, NOT a repaired
    // native XLSX. No formula removal or cached-formula acceptance occurs here.
    const csv = readFileSync(
      new URL(
        '../../evidence/quickbooks-acceptance-20261021/target-transaction-journal-145.csv',
        import.meta.url,
      ),
      'utf8',
    );
    const values: Array<Array<string | number>> = Papa.parse<string[]>(csv).data;
    if (values.at(-1)?.every((value) => value === '')) values.pop();
    for (const row of [6, 7, 8, 9]) {
      for (const col of [7, 8]) {
        if (values[row][col]) values[row][col] = Number(String(values[row][col]).replace('$', ''));
      }
    }
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet(values), 'Sheet1');
    const input = withExtension(new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' })));
    const matrix = await readXlsxMatrix(input);
    expect(matrix.inspection).toEqual({
      sheets: [{ name: 'Sheet1', rows: 14, columns: 9, hidden: false }],
      date1904: false,
      requiresSheetSelection: false,
    });
    expect(matrix.source.fileHash).toBe(createHash('sha256').update(input).digest('hex'));
    expect(matrix.source.fileHash).not.toBe(nativeHash);
    expect(matrix.records.map((row) => row.physicalRow)).toEqual(
      Array.from({ length: 14 }, (_, i) => i + 1),
    );
    expect(matrix.records[4].values).toEqual([
      '',
      'Transaction date',
      'Transaction type',
      'Num',
      'Name',
      'Description',
      'Account Name',
      'Debit',
      'Credit',
    ]);
    expect(matrix.records[5].values).toEqual(['145', '', '', '', '', '', '', '', '']);
    expect(matrix.records[6].values.slice(1, 4)).toEqual([
      '09/30/2026',
      'Journal Entry',
      'RDCE641C900E',
    ]);
    expect(matrix.records[6].values.slice(6)).toEqual(['Bank Charges', '900', '']);
    expect(matrix.records[7].values.slice(6)).toEqual(['Uncategorized Asset', '', '900']);
    expect(matrix.records[8].values).toEqual([
      'Total for 145',
      '',
      '',
      '',
      '',
      '',
      '',
      '900',
      '900',
    ]);
    expect(matrix.records[9].values).toEqual(['TOTAL', '', '', '', '', '', '', '900', '900']);
    expect(matrix.records[13].values[0]).toBe(' Wednesday, October 21, 2026 11:52 AM GMTZ');
    const rawPosting = JSON.parse(matrix.records[6].raw);
    expect(rawPosting[1]).toMatchObject({ address: 'B7', type: 's', value: '09/30/2026' });
    expect(rawPosting[7]).toMatchObject({ address: 'H7', type: 'n', value: 900 });
  });
  it('allows inert native controls for preview without a false epoch conflict', () => {
    const input = readFileSync(nativePath);
    expect(input.length).toBe(8880);
    expect(createHash('sha256').update(input).digest('hex')).toBe(nativeHash);
    const parts = unzipSync(input);
    expect(strFromU8(parts[workbookPath])).toContain('<workbookPr defaultThemeVersion="166925"');
    expect(strFromU8(parts[workbookPath])).toContain('<x15:workbookPr chartTrackingRefBase="1"');
    expect(strFromU8(parts[sheetPath]).match(/<f>[^<]*<\/f>/g)).toEqual([
      '<f>H7+H8</f>',
      '<f>I7+I8</f>',
      '<f>H9</f>',
      '<f>I9</f>',
    ]);
    expect(inspectXlsx(input).sheets).toHaveLength(1);
    expect(createHash('sha256').update(readFileSync(nativePath)).digest('hex')).toBe(nativeHash);
  });

  it.each(['<f>H7+H8</f>', `<x:f xmlns:x="urn:spoof">1+1</x:f>`])(
    'does not waive the formula guard after accepting safe extension metadata: %s',
    (formula) => {
      blocked(
        edit(
          withExtension(),
          (xml) => xml.replace('<v>900</v>', `${formula}<v>900</v>`),
          sheetPath,
        ),
        'XLSX_FORMULA',
      );
    },
  );

  it('still rejects external relationships and internal cell hyperlinks', () => {
    blocked(
      edit(
        withExtension(),
        (xml) =>
          xml.replace(
            '</Relationships>',
            '<Relationship Id="bad" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/></Relationships>',
          ),
        'xl/_rels/workbook.xml.rels',
      ),
      'XLSX_EXTERNAL_LINK',
    );
    blocked(
      edit(
        withExtension(),
        (xml) =>
          xml.replace(
            '</worksheet>',
            '<hyperlinks><hyperlink ref="B2" location="Data!A1"/></hyperlinks></worksheet>',
          ),
        sheetPath,
      ),
      'XLSX_EXTERNAL_LINK',
    );
  });
});
