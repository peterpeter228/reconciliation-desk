import { describe, expect, it } from 'vitest';
import { read, utils, write } from 'xlsx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { inspectXlsx, readXlsxMatrix, XlsxImportError } from '../../src/ingestion/xlsx';

const packageNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const contentNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const relsPath = 'xl/_rels/workbook.xml.rels';
const typesPath = '[Content_Types].xml';
const sheetPath = 'xl/worksheets/sheet1.xml';
const target = 'https://example.invalid/data';

function workbook(): Uint8Array {
  const book = utils.book_new();
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['Date', 'Amount', 'Description'],
      ['2026-09-01', 12.34, 'ACH & café'],
    ]),
    'Data',
  );
  return new Uint8Array(write(book, { bookType: 'xlsx', type: 'array', bookSST: true }));
}

function edit(path: string, change: (xml: string) => string): Uint8Array {
  const parts = unzipSync(workbook());
  parts[path] = strToU8(change(strFromU8(parts[path])));
  return zipSync(parts, { level: 0 });
}

function relationship(fragment: string): Uint8Array {
  return edit(relsPath, (xml) => xml.replace('</Relationships>', fragment + '</Relationships>'));
}

function expectBlocked(input: Uint8Array, code: string): void {
  let caught: unknown;
  try {
    inspectXlsx(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(XlsxImportError);
  expect((caught as XlsxImportError).code).toBe(code);
}

const aliasStyles = [
  ['namespace-prefixed', (key: string) => `p:${key}`],
  ['underscore-suffixed', (key: string) => `${key}_shadow`],
  ['lowercase', (key: string) => key.toLowerCase()],
  ['uppercase', (key: string) => key.toUpperCase()],
] as const;

describe('Argon P2-2 package metadata guard', () => {
  it('rejects the exact prefixed-element/attribute shape without relying on SheetJS ignoring it', () => {
    expectBlocked(
      relationship(
        `<r:Relationship xmlns:r="${packageNamespace}" Id="rId9" r:Type="${officeNamespace}/externalLink" r:Target="${target}" r:TargetMode="External"/>`,
      ),
      'XLSX_XML_UNSUPPORTED',
    );
  });

  it.each(['Relationship', 'r:Relationship'])(
    'still rejects canonical external attributes on a %s element',
    (tag) => {
      expectBlocked(
        relationship(
          `<${tag} xmlns:r="${packageNamespace}" Id="bad" Type="${officeNamespace}/externalLink" Target="${target}" TargetMode="External"/>`,
        ),
        'XLSX_EXTERNAL_LINK',
      );
    },
  );

  it.each(['relationship', 'RELATIONSHIP', 'r:relationship'])(
    'rejects the nonstandard case of %s rather than silently ignoring metadata',
    (tag) => {
      expectBlocked(
        relationship(
          `<${tag} xmlns:r="${packageNamespace}" Id="bad" Type="${officeNamespace}/externalLink" Target="${target}" TargetMode="External"/>`,
        ),
        'XLSX_XML_UNSUPPORTED',
      );
    },
  );

  for (const [style, alias] of aliasStyles) {
    it.each(['Id', 'Type', 'Target', 'TargetMode'])(
      `rejects a ${style} %s attribute even without an active-content keyword`,
      (key) => {
        const attributes = {
          Id: 'unused',
          Type: `${officeNamespace}/worksheet`,
          Target: 'worksheets/sheet1.xml',
          TargetMode: 'Internal',
        };
        const fragment = Object.entries(attributes)
          .map(([name, value]) => `${name === key ? alias(name) : name}="${value}"`)
          .join(' ');
        expectBlocked(
          relationship(`<Relationship xmlns:p="${packageNamespace}" ${fragment}/>`),
          'XLSX_XML_UNSUPPORTED',
        );
      },
    );

    it.each([
      ['Override', 'PartName'],
      ['Override', 'ContentType'],
      ['Default', 'Extension'],
      ['Default', 'ContentType'],
    ])(`rejects %s with a ${style} %s attribute`, (tag, key) => {
      const attributes =
        tag === 'Override'
          ? { PartName: '/docProps/unused.xml', ContentType: 'application/xml' }
          : { Extension: 'unused', ContentType: 'application/xml' };
      const fragment = Object.entries(attributes)
        .map(([name, value]) => `${name === key ? alias(name) : name}="${value}"`)
        .join(' ');
      expectBlocked(
        edit(typesPath, (xml) =>
          xml.replace('</Types>', `<${tag} xmlns:p="${contentNamespace}" ${fragment}/></Types>`),
        ),
        'XLSX_XML_UNSUPPORTED',
      );
    });
  }

  it.each(['override', 'OVERRIDE', 'p:override', 'default', 'DEFAULT', 'p:default'])(
    'rejects the case-variant content-type element %s',
    (tag) => {
      expectBlocked(
        edit(typesPath, (xml) =>
          xml.replace('</Types>', `<${tag} xmlns:p="${contentNamespace}"/></Types>`),
        ),
        'XLSX_XML_UNSUPPORTED',
      );
    },
  );

  it.each(['ContentType', 'p:ContentType', 'ContentType_shadow', 'contenttype'])(
    'blocks macro-enabled workbook content using %s',
    (key) => {
      expectBlocked(
        edit(typesPath, (xml) =>
          xml.replace(
            /<Override PartName="\/xl\/workbook.xml" ContentType="[^"]*"\/>/,
            `<Override xmlns:p="${contentNamespace}" PartName="/xl/workbook.xml" ${key}="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>`,
          ),
        ),
        key === 'ContentType' ? 'XLSX_ACTIVE_CONTENT' : 'XLSX_XML_UNSUPPORTED',
      );
    },
  );

  it.each(['ContentType', 'p:ContentType', 'ContentType_shadow', 'contenttype'])(
    'blocks active XML default content using %s',
    (key) => {
      expectBlocked(
        edit(typesPath, (xml) =>
          xml.replace(
            '<Default Extension="xml" ContentType="application/xml"/>',
            `<Default xmlns:p="${contentNamespace}" Extension="xml" ${key}="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>`,
          ),
        ),
        key === 'ContentType' ? 'XLSX_ACTIVE_CONTENT' : 'XLSX_XML_UNSUPPORTED',
      );
    },
  );

  it.each(['Target', 'p:Target', 'target', 'Target_shadow'])(
    'rejects duplicate or alias-colliding Relationship attributes: Target and %s',
    (key) => {
      expectBlocked(
        relationship(
          `<Relationship xmlns:p="${packageNamespace}" Id="unused" Type="${officeNamespace}/worksheet" Target="worksheets/sheet1.xml" ${key}="worksheets/sheet1.xml"/>`,
        ),
        'XLSX_XML_INVALID',
      );
    },
  );

  it.each(['ContentType', 'p:ContentType', 'contenttype', 'ContentType_shadow'])(
    'rejects duplicate or alias-colliding ContentType and %s',
    (key) => {
      expectBlocked(
        edit(typesPath, (xml) =>
          xml.replace(
            '</Types>',
            `<Override xmlns:p="${contentNamespace}" PartName="/docProps/unused.xml" ContentType="application/xml" ${key}="application/xml"/></Types>`,
          ),
        ),
        'XLSX_XML_INVALID',
      );
    },
  );

  it('preserves standard r:id sheet links, namespace declarations and unused binary defaults', async () => {
    const input = edit(relsPath, (xml) =>
      xml.replace('<Relationship ', `<Relationship xmlns:extra="${packageNamespace}" `),
    );
    const parts = unzipSync(input);
    expect(strFromU8(parts['xl/workbook.xml'])).toContain('r:id="');
    expect(strFromU8(parts[typesPath])).toContain('Extension="bin"');
    expect(inspectXlsx(input).sheets).toEqual([
      { name: 'Data', rows: 2, columns: 3, hidden: false },
    ]);
    const matrix = await readXlsxMatrix(input);
    expect(matrix.source.parserVersion).toBe('xlsx-local-1.1/sheetjs-0.20.3');
    expect(matrix.records[1].values).toEqual(['2026-09-01', '12.34', 'ACH & café']);
  });

  it('keeps canonical namespace-prefixed content-type elements readable', async () => {
    const input = edit(typesPath, (xml) =>
      xml
        .replace('<Types ', `<Types xmlns:p="${contentNamespace}" `)
        .replace(/<(Default|Override)\b/g, '<p:$1'),
    );
    expect((await readXlsxMatrix(input)).records[1].values[1]).toBe('12.34');
  });
});

describe('SheetJS parser-differential evidence, not a network-exploit test', () => {
  it.each(['p:', '_shadow'])(
    'demonstrates SheetJS interpreting %s aliases while the guard rejects them before parsing',
    (style) => {
      const parts = unzipSync(workbook());
      const alias = (key: string) => (style === 'p:' ? style + key : key + style);
      parts['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
        `<Relationships xmlns="${packageNamespace}"><Relationship xmlns:p="${packageNamespace}" Id="link" ${alias('Type')}="${officeNamespace}/hyperlink" ${alias('Target')}="${target}" ${alias('TargetMode')}="External"/></Relationships>`,
      );
      parts[sheetPath] = strToU8(
        strFromU8(parts[sheetPath]).replace(
          '</worksheet>',
          '<hyperlinks><hyperlink ref="B2" r:id="link"/></hyperlinks></worksheet>',
        ),
      );
      const input = zipSync(parts, { level: 0 });
      // Only inspect the in-memory parse result. This does not claim a request was made.
      expect(read(input, { type: 'array', WTF: true }).Sheets.Data.B2.l?.Target).toBe(target);
      expectBlocked(input, 'XLSX_XML_UNSUPPORTED');
    },
  );

  it('distinguishes ignored prefixed Relationship elements from interpreted aliased attributes', () => {
    const parts = unzipSync(workbook());
    parts['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(
      `<Relationships xmlns="${packageNamespace}"><p:Relationship xmlns:p="${packageNamespace}" Id="link" p:Type="${officeNamespace}/hyperlink" p:Target="${target}" p:TargetMode="External"/></Relationships>`,
    );
    parts[sheetPath] = strToU8(
      strFromU8(parts[sheetPath]).replace(
        '</worksheet>',
        '<hyperlinks><hyperlink ref="B2" r:id="link"/></hyperlinks></worksheet>',
      ),
    );
    const input = zipSync(parts, { level: 0 });
    const parsed = read(input, { type: 'array', WTF: true }).Sheets.Data.B2;
    expect(parsed.l?.Target).not.toBe(target);
    expect(parsed.l?.Rel?.TargetMode).toBe('Internal');
    expectBlocked(input, 'XLSX_XML_UNSUPPORTED');
  });
});
