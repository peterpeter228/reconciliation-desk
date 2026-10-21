import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { read, utils, write } from 'xlsx';
import { inspectXlsx, readXlsxMatrix, XlsxImportError } from '../../src/ingestion/xlsx';

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const strict = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
const packageNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const contentNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const workbookPath = 'xl/workbook.xml';
const sheetPath = 'xl/worksheets/sheet1.xml';
const stringsPath = 'xl/sharedStrings.xml';
const relsPath = 'xl/_rels/workbook.xml.rels';
const typesPath = '[Content_Types].xml';
const relationship = `<Relationship Id="unused" Type="${officeNamespace}/worksheet" Target="worksheets/sheet1.xml"/>`;
const override = '<Override PartName="/docProps/unused.xml" ContentType="application/xml"/>';
const defaultType = '<Default Extension="unused" ContentType="application/xml"/>';

function workbook(sharedStrings = false, date1904 = false): Uint8Array {
  const book = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ['Date', 'Amount', 'Description'],
    [date1904 ? 44804 : 46266, 900, 'ACH & café'],
  ]);
  sheet.A2.z = 'mm/dd/yyyy';
  sheet.B2.z = '$0.00';
  utils.book_append_sheet(book, sheet, 'Data');
  book.Workbook = { WBProps: { date1904 } };
  return new Uint8Array(write(book, { bookType: 'xlsx', type: 'array', bookSST: sharedStrings }));
}

function edit(input: Uint8Array, path: string, change: (xml: string) => string): Uint8Array {
  const parts = unzipSync(input);
  const before = strFromU8(parts[path]);
  const after = change(before);
  expect(after).not.toBe(before); // A mutation that misses its target is not a regression test.
  parts[path] = strToU8(after);
  return zipSync(parts, { level: 0 });
}

function namespace(xml: string, tag: string, uri: string): string {
  // Replace a root's existing declaration; give child elements a local binding.
  return xml.replace(new RegExp(`<${tag}(?=[\\s/>])[^>]*>`), (node) =>
    node.includes(' xmlns="')
      ? node.replace(/ xmlns="[^"]*"/, ` xmlns="${uri}"`)
      : node.replace(`<${tag}`, `<${tag} xmlns="${uri}"`),
  );
}

function inlineWorkbook(): Uint8Array {
  return edit(workbook(), sheetPath, (xml) =>
    xml.replace(
      /<c r="C2"[^>]*>.*?<\/c>/,
      '<c r="C2" t="inlineStr"><is><r><rPr><b/></rPr><t>ACH &amp; café</t></r></is></c>',
    ),
  );
}

function blocked(input: Uint8Array, code = 'XLSX_XML_UNSUPPORTED'): void {
  let error: unknown;
  try {
    inspectXlsx(input);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(XlsxImportError);
  expect((error as XlsxImportError).code).toBe(code);
}

const coreNodes = [
  [workbookPath, 'sheets'],
  [workbookPath, 'sheet'],
  [sheetPath, 'worksheet'],
  [sheetPath, 'sheetData'],
  [sheetPath, 'row'],
  [sheetPath, 'c'],
  [sheetPath, 'v'],
  [stringsPath, 'sst'],
  [stringsPath, 'si'],
  [stringsPath, 't'],
] as const;

describe('Argon 1.3 narrow spreadsheet namespace profile', () => {
  for (const uri of ['urn:spoof', '']) {
    it.each(coreNodes)(`rejects %s/%s with namespace "${uri}"`, (path, tag) => {
      blocked(edit(workbook(true), path, (xml) => namespace(xml, tag, uri)));
    });

    it.each(['is', 't'])(`rejects inline-string %s with namespace "${uri}"`, (tag) => {
      blocked(edit(inlineWorkbook(), sheetPath, (xml) => namespace(xml, tag, uri)));
    });
  }

  it.each(['xmlns:spoof="urn:spoof"', ''])(
    'rejects fake or unresolved value prefixes: %s',
    (declaration) => {
      blocked(
        edit(workbook(), sheetPath, (xml) =>
          xml.replace('<v>900</v>', `<spoof:v ${declaration}>900</spoof:v>`),
        ),
      );
    },
  );

  for (const wrapper of ['unknown', 'workbook']) {
    it.each(['c', 'sheetData'])(
      `does not lose the %s namespace guard beneath a ${wrapper} wrapper`,
      (tag) => {
        const input = edit(workbook(), sheetPath, (xml) =>
          xml
            .replace('<worksheet ', `<${wrapper} `)
            .replace('</worksheet>', `</${wrapper}>`)
            .replace(new RegExp(`<${tag}(?=[\\s/>])`), `<spoof:${tag} xmlns:spoof="urn:spoof"`)
            .replace(`</${tag}>`, `</spoof:${tag}>`),
        );
        // Prefix only this element: descendants retain the valid default namespace.
        // Otherwise a foreign child v would conceal a missing c/sheetData check.
        expect(read(input, { type: 'array', WTF: true }).Sheets.Data.B2.v).toBe(900);
        blocked(input);
      },
    );
  }

  it('rejects a fake workbook root even when its data children restore a valid namespace', () => {
    const input = edit(workbook(), workbookPath, (xml) =>
      namespace(xml, 'workbook', 'urn:spoof')
        .replace(/<workbookPr\b[^>]*\/>/, '')
        .replace('<sheets>', `<sheets xmlns="${main}">`),
    );
    blocked(input);
  });

  it('still rejects fake-namespace formulas by local name before considering values', () => {
    blocked(
      edit(workbook(), sheetPath, (xml) =>
        xml.replace('<v>900</v>', '<spoof:f xmlns:spoof="urn:spoof">900</spoof:f><v>900</v>'),
      ),
      'XLSX_FORMULA',
    );
  });
});

describe('Argon 1.3 OPC namespace and part context', () => {
  it.each([
    [relsPath, 'Relationships'],
    [relsPath, 'Relationship'],
    [typesPath, 'Types'],
    [typesPath, 'Override'],
    [typesPath, 'Default'],
  ])('rejects a foreign namespace on %s/%s', (path, tag) => {
    blocked(edit(workbook(), path, (xml) => namespace(xml, tag, 'urn:spoof')));
  });

  it.each([
    [relsPath, 'Relationships'],
    [typesPath, 'Types'],
  ])('rejects a missing namespace on %s/%s', (path, tag) => {
    blocked(edit(workbook(), path, (xml) => namespace(xml, tag, '')));
  });

  it.each([relationship, override, defaultType])(
    'rejects package metadata inserted into a worksheet: %s',
    (node) => {
      const uri = node.startsWith('<Relationship') ? packageNamespace : contentNamespace;
      const fragment = node.replace(' ', ` xmlns="${uri}" `);
      blocked(
        edit(workbook(), sheetPath, (xml) =>
          xml.replace('</worksheet>', fragment + '</worksheet>'),
        ),
      );
    },
  );

  it.each([
    [relsPath, 'Relationships', relationship],
    [typesPath, 'Types', override],
    [typesPath, 'Types', defaultType],
  ])('requires metadata to be a direct child of %s/%s', (path, root, node) => {
    blocked(
      edit(workbook(), path, (xml) =>
        xml.replace(`</${root}>`, `<nested>${node}</nested></${root}>`),
      ),
    );
  });

  it.each([
    [
      'xl/metadata.xml',
      `<Relationships xmlns="${packageNamespace}">${relationship}</Relationships>`,
    ],
    [
      'xl/metadata.rels',
      `<Relationships xmlns="${packageNamespace}">${relationship}</Relationships>`,
    ],
    ['xl/_rels/metadata.xml.rels', '<NotRelationships/>'],
    ['xl/metadata.xml', `<Types xmlns="${contentNamespace}">${override}</Types>`],
  ])('rejects misplaced or wrong-root OPC metadata in %s', (path, xml) => {
    const parts = unzipSync(workbook());
    parts[path] = strToU8(xml);
    blocked(zipSync(parts, { level: 0 }));
  });

  it('keeps the external-relationship guard active for a spoofed metadata namespace', () => {
    const input = edit(workbook(), relsPath, (xml) =>
      xml.replace(
        '</Relationships>',
        `<Relationship xmlns="urn:spoof" Id="bad" Type="${officeNamespace}/hyperlink" Target="https://example.invalid/" TargetMode="External"/></Relationships>`,
      ),
    );
    blocked(input, 'XLSX_EXTERNAL_LINK');
  });
});

describe('namespace hardening compatibility controls', () => {
  for (const uri of [main, strict]) {
    it.each([false, true])(
      `preserves styles, strings, both epochs and OPC namespaces with ${uri}, shared strings=%s`,
      async (sharedStrings) => {
        for (const date1904 of [false, true]) {
          const parts = unzipSync(workbook(sharedStrings, date1904));
          for (const [path, value] of Object.entries(parts)) {
            const xml = strFromU8(value)
              .replaceAll(main, uri)
              .replaceAll(
                officeNamespace,
                uri === main
                  ? officeNamespace
                  : 'http://purl.oclc.org/ooxml/officeDocument/relationships',
              );
            parts[path] = strToU8(xml);
          }
          const input = zipSync(parts, { level: 0 });
          const result = await readXlsxMatrix(input);
          expect(result.inspection.date1904).toBe(date1904);
          expect(result.records[1].values).toEqual(['2026-09-01', '900', 'ACH & café']);
          expect(result.source.parserVersion).toBe('xlsx-local-1.3/sheetjs-0.20.3');
          expect(strFromU8(parts[relsPath])).toContain(packageNamespace);
          expect(strFromU8(parts[typesPath])).toContain(contentNamespace);
        }
      },
    );

    it(`resolves prefixed worksheet data and inline rich text in ${uri}`, async () => {
      const input = edit(inlineWorkbook(), sheetPath, (xml) =>
        xml
          .replace(`xmlns="${main}"`, `xmlns="${uri}" xmlns:s="${uri}"`)
          .replace(/<(\/?)(worksheet|sheetData|row|c|v|is|r|rPr|b|t)(?=[\s/>])/g, '<$1s:$2'),
      );
      expect((await readXlsxMatrix(input)).records[1].values).toEqual([
        '2026-09-01',
        '900',
        'ACH & café',
      ]);
    });
  }

  it('keeps shared rich-text runs and XML space handling readable', async () => {
    const input = edit(workbook(true), stringsPath, (xml) =>
      xml.replace(
        '<t>ACH &amp; café</t>',
        '<r><rPr><b/></rPr><t xml:space="preserve">ACH &amp; </t></r><r><t>café</t></r>',
      ),
    );
    expect((await readXlsxMatrix(input)).records[1].values[2]).toBe('ACH & café');
  });

  it('does not apply SpreadsheetML text namespaces to DrawingML a:t', async () => {
    const parts = unzipSync(workbook());
    parts['xl/drawings/drawing1.xml'] = strToU8(
      '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        '<xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="1000000" cy="400000"/>' +
        '<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="1" name="Caption"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>' +
        '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
        '<xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Caption</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>',
    );
    parts['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
      `<Relationships xmlns="${packageNamespace}"><Relationship Id="drawing" Type="${officeNamespace}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    );
    parts[sheetPath] = strToU8(
      strFromU8(parts[sheetPath]).replace('</worksheet>', '<drawing r:id="drawing"/></worksheet>'),
    );
    parts[typesPath] = strToU8(
      strFromU8(parts[typesPath]).replace(
        '</Types>',
        '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>',
      ),
    );
    expect((await readXlsxMatrix(zipSync(parts, { level: 0 }))).records[1].values).toEqual([
      '2026-09-01',
      '900',
      'ACH & café',
    ]);
  });
});

describe('SheetJS observations, not a new parser-differential exploit', () => {
  it.each([
    [sheetPath, (xml: string) => namespace(xml, 'c', 'urn:spoof')],
    [sheetPath, (xml: string) => namespace(xml, 'v', 'urn:spoof')],
    [
      workbookPath,
      (xml: string) => xml.replace('<sheet name=', '<custom:sheet xmlns:custom="urn:spoof" name='),
    ],
    [relsPath, (xml: string) => namespace(xml, 'Relationships', 'urn:spoof')],
    [typesPath, (xml: string) => namespace(xml, 'Override', 'urn:spoof')],
    [typesPath, (xml: string) => namespace(xml, 'Default', 'urn:spoof')],
  ])('shows SheetJS reading the same values from foreign namespaces in %s', (path, change) => {
    const input = edit(workbook(), path, change);
    const raw = read(input, { type: 'array', WTF: true });
    expect(raw.SheetNames).toEqual(['Data']);
    expect(raw.Sheets.Data.B2.v).toBe(900);
    blocked(input);
  });

  it('reproduces the reported fake-prefixed c/v shape without a formula or network operation', () => {
    const input = edit(workbook(), sheetPath, (xml) =>
      xml.replace(
        /<c r="B2"[^>]*><v>900<\/v><\/c>/,
        '<spoof:c xmlns:spoof="urn:custom" r="B2" t="n"><spoof:v>900</spoof:v></spoof:c>',
      ),
    );
    expect(read(input, { type: 'array', WTF: true }).Sheets.Data.B2.v).toBe(900);
    blocked(input);
  });

  it('shows SheetJS already refusing a foreign content-types root', () => {
    const input = edit(workbook(), typesPath, (xml) => namespace(xml, 'Types', 'urn:spoof'));
    expect(() => read(input, { type: 'array', WTF: true })).toThrow('Unknown Namespace: urn:spoof');
    blocked(input);
  });
});
