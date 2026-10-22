import { Inflate, zipSync } from 'fflate';
import { read, SSF, utils, type WorkBook, type CellObject } from 'xlsx';
import { IMPORT_LIMITS, parseMatrix, type MatrixRecord } from './csv';
import { canonicalJson, sha256 } from './primitives';
import type { ParseOptions, ParseResult, SourceKind } from './types';
import type { RowByKind } from './normalize';

/** Deliberately narrow, values-only XLSX profile. No network, evaluation or workbook writes. */
export const XLSX_LIMITS = Object.freeze({
  fileBytes: IMPORT_LIMITS.fileBytes,
  uncompressedBytes: 40 * 1024 * 1024,
  partBytes: 20 * 1024 * 1024,
  compressionRatio: 100,
  entries: 256,
  sheets: 5,
  physicalRows: IMPORT_LIMITS.rows + 30,
  columns: IMPORT_LIMITS.columns,
  cellsPerSheet: 500_000,
  cellBytes: IMPORT_LIMITS.cellBytes,
  xmlDepth: 64,
  xmlElements: 2_000_000,
  styles: 10_000,
});
export interface XlsxOptions extends ParseOptions {
  sheetName?: string;
}
export interface XlsxSheetInfo {
  name: string;
  rows: number;
  columns: number;
  hidden: boolean;
}
export interface XlsxInspection {
  sheets: XlsxSheetInfo[];
  date1904: boolean;
  requiresSheetSelection: boolean;
}
export class XlsxImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'XlsxImportError';
  }
}
function fail(code: string, message: string): never {
  throw new XlsxImportError(code, message);
}
const encoder = new TextEncoder();
const utf8 = new TextDecoder('utf-8', { fatal: true });
interface ZipPart {
  name: string;
  compressed: number;
  size: number;
  crc: number;
  method: number;
  start: number;
  end: number;
  local: number;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Check both ZIP directories before any decompression; do not trust reported sizes alone. */
function zipParts(bytes: Uint8Array): ZipPart[] {
  if (bytes.length > XLSX_LIMITS.fileBytes)
    fail('XLSX_FILE_LIMIT', 'XLSX exceeds the 10 MB per-file limit.');
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    fail(
      'XLSX_FORMAT',
      'Only unencrypted .xlsx ZIP workbooks are accepted; XLS, XLSB, macros and password-protected files are not supported.',
    );
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => {
    if (p < 0 || p + 2 > bytes.length) fail('XLSX_ZIP_INVALID', 'Truncated ZIP metadata.');
    return v.getUint16(p, true);
  };
  const u32 = (p: number) => {
    if (p < 0 || p + 4 > bytes.length) fail('XLSX_ZIP_INVALID', 'Truncated ZIP metadata.');
    return v.getUint32(p, true);
  };
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail('XLSX_ZIP_INVALID', 'ZIP end directory is missing.');
  const count = u16(eocd + 10),
    directorySize = u32(eocd + 12),
    directory = u32(eocd + 16);
  if (
    u16(eocd + 4) ||
    u16(eocd + 6) ||
    u16(eocd + 8) !== count ||
    count === 65535 ||
    directory === 0xffffffff ||
    directorySize === 0xffffffff
  )
    fail('XLSX_ZIP_UNSUPPORTED', 'Split and ZIP64 workbooks are not accepted.');
  if (!count || count > XLSX_LIMITS.entries)
    fail('XLSX_ZIP_LIMIT', 'Workbook has too many ZIP parts (maximum 256).');
  if (directory + directorySize !== eocd)
    fail('XLSX_ZIP_INVALID', 'ZIP directory boundaries are inconsistent.');
  function extra(p: number, length: number) {
    const end = p + length;
    while (p < end) {
      if (p + 4 > end) fail('XLSX_ZIP_INVALID', 'Malformed ZIP extra field.');
      const id = u16(p),
        n = u16(p + 2);
      p += 4;
      if (p + n > end) fail('XLSX_ZIP_INVALID', 'Malformed ZIP extra field.');
      if ([1, 0x9901, 0x0017, 0x7075].includes(id))
        fail(
          'XLSX_ZIP_UNSUPPORTED',
          'ZIP64, encryption and alternate path metadata are not accepted.',
        );
      p += n;
    }
  }
  function nameAt(p: number, n: number): string {
    if (!n || p + n > directory || n > 240) fail('XLSX_ZIP_INVALID', 'Invalid ZIP part name.');
    const name = String.fromCharCode(...bytes.subarray(p, p + n));
    if (
      !/^[A-Za-z0-9_.\[\]\-/]+$/.test(name) ||
      name.startsWith('/') ||
      name.split('/').some((x) => x === '..' || x === '.') ||
      name.includes('//')
    )
      fail('XLSX_ZIP_PATH', 'Unsupported or unsafe workbook part path.');
    if (
      /(?:vba|macrosheet|dialogsheet|externallink|connections|querytable|activex|embeddings|customui)/i.test(
        name,
      ) ||
      !/(?:\.xml|\.rels|\/)$/i.test(name)
    )
      fail(
        'XLSX_ACTIVE_CONTENT',
        'Macros, external data, embedded objects and non-XML workbook parts are not accepted. Export a values-only XLSX or CSV.',
      );
    return name;
  }
  const result: ZipPart[] = [],
    names = new Set<string>();
  let p = directory,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || u32(p) !== 0x02014b50)
      fail('XLSX_ZIP_INVALID', 'Invalid ZIP central directory.');
    const flags = u16(p + 8),
      method = u16(p + 10),
      crc = u32(p + 16),
      compressed = u32(p + 20),
      size = u32(p + 24),
      n = u16(p + 28),
      ex = u16(p + 30),
      comment = u16(p + 32),
      local = u32(p + 42);
    if (p + 46 + n + ex + comment > eocd)
      fail('XLSX_ZIP_INVALID', 'Truncated ZIP directory entry.');
    if (flags & (1 | 64 | 8192)) fail('XLSX_ENCRYPTED', 'Encrypted workbooks are not accepted.');
    if (flags & ~0x80e || ![0, 8].includes(method) || u16(p + 6) > 20 || u16(p + 34))
      fail('XLSX_ZIP_UNSUPPORTED', 'Unsupported ZIP flags, compression or archive version.');
    // Central names are after directory; decode separately with the same path checks.
    const centralNameBytes = bytes.subarray(p + 46, p + 46 + n);
    const centralName = String.fromCharCode(...centralNameBytes);
    if (
      local >= directory ||
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      u16(local + 4) > 20
    )
      fail('XLSX_ZIP_INVALID', 'Local and central ZIP headers disagree.');
    const ln = u16(local + 26),
      le = u16(local + 28),
      name = nameAt(local + 30, ln);
    if (name !== centralName || ln !== n)
      fail('XLSX_ZIP_INVALID', 'Local and central ZIP paths disagree.');
    if (names.has(name.toLowerCase()))
      fail('XLSX_ZIP_INVALID', 'Duplicate workbook part names are not accepted.');
    names.add(name.toLowerCase());
    extra(p + 46 + n, ex);
    extra(local + 30 + ln, le);
    const start = local + 30 + ln + le;
    let end = start + compressed;
    if (start > directory || end > directory)
      fail('XLSX_ZIP_INVALID', 'ZIP data extends beyond its allowed region.');
    if (
      size > XLSX_LIMITS.partBytes ||
      size / Math.max(1, compressed) > XLSX_LIMITS.compressionRatio ||
      (total += size) > XLSX_LIMITS.uncompressedBytes
    )
      fail(
        'XLSX_ZIP_LIMIT',
        'Workbook exceeds the 20 MB part, 40 MB expanded total, or 100:1 compression-ratio safety limit.',
      );
    if (method === 0 && size !== compressed) fail('XLSX_ZIP_INVALID', 'Stored ZIP size mismatch.');
    if (flags & 8) {
      for (const [offset, expected] of [
        [14, crc],
        [18, compressed],
        [22, size],
      ]) {
        const actual = u32(local + offset);
        if (actual !== 0 && actual !== expected)
          fail('XLSX_ZIP_INVALID', 'Local ZIP sizes disagree.');
      }
      if (u32(end) === 0x08074b50) end += 4;
      if (u32(end) !== crc || u32(end + 4) !== compressed || u32(end + 8) !== size)
        fail('XLSX_ZIP_INVALID', 'ZIP descriptor does not match the directory.');
      end += 12;
    } else if (
      u32(local + 14) !== crc ||
      u32(local + 18) !== compressed ||
      u32(local + 22) !== size
    )
      fail('XLSX_ZIP_INVALID', 'Local and central ZIP sizes disagree.');
    if (end > directory) fail('XLSX_ZIP_INVALID', 'ZIP descriptor overlaps the directory.');
    result.push({ name, compressed, size, crc, method, start, end, local });
    p += 46 + n + ex + comment;
  }
  if (p !== eocd) fail('XLSX_ZIP_INVALID', 'Extra ZIP directory records are not accepted.');
  let next = 0;
  for (const part of [...result].sort((a, b) => a.local - b.local)) {
    if (part.local !== next)
      fail('XLSX_ZIP_INVALID', 'Overlapping or unlisted ZIP content is not accepted.');
    next = part.end;
  }
  if (next !== directory) fail('XLSX_ZIP_INVALID', 'Unlisted ZIP content is not accepted.');
  return result;
}
function inflatePart(bytes: Uint8Array, part: ZipPart): Uint8Array {
  const compressed = bytes.subarray(part.start, part.start + part.compressed);
  const out = new Uint8Array(part.size);
  let written = 0;
  const consume = (chunk: Uint8Array) => {
    if (written + chunk.length > part.size || written + chunk.length > XLSX_LIMITS.partBytes)
      fail('XLSX_ZIP_LIMIT', 'Actual expanded data exceeds declared or permitted size.');
    out.set(chunk, written);
    written += chunk.length;
  };
  if (part.method === 0) consume(compressed);
  else {
    // 1 KB input pushes bound transient inflater output, even when the size metadata lies.
    const stream = new Inflate(consume);
    try {
      for (let p = 0; p < compressed.length; p += 1024)
        stream.push(compressed.subarray(p, p + 1024), p + 1024 >= compressed.length);
    } catch (error) {
      if (error instanceof XlsxImportError) throw error;
      fail('XLSX_ZIP_INVALID', 'Invalid DEFLATE data.');
    }
  }
  if (written !== part.size || crc32(out) !== part.crc)
    fail('XLSX_ZIP_INVALID', 'Expanded size or checksum does not match the ZIP directory.');
  return out;
}

interface XmlElement {
  name: string;
  namespace: string | undefined;
  attrs: Record<string, string>;
}
interface XmlTag extends XmlElement {
  ancestors: readonly XmlElement[];
  closing: boolean;
}
interface XmlFrame extends XmlElement {
  fullName: string;
  namespaces: Record<string, string>;
}
const spreadsheetNamespaces = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
]);
const packageRelationshipsNamespace =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const packageContentTypesNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
// Only classify spreadsheet data in its document context. In particular, DrawingML
// a:t and chart c:v are not worksheet/shared-string values and keep their own schemas.
const spreadsheetDataElements = new Map([
  ['workbook', new Set(['sheets', 'sheet'])],
  ['sheets', new Set(['sheets', 'sheet'])],
  ['worksheet', new Set(['worksheet', 'sheetData', 'row', 'c', 'is'])],
  ['sheetData', new Set(['sheetData', 'row', 'c', 'is'])],
  ['sst', new Set(['sst', 'si'])],
]);
const x15Namespace = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
const x15WorkbookExtension = '{140A7094-0E35-4892-8432-C4D2E57EDEB5}';
const xmlNamespace = 'http://www.w3.org/XML/1998/namespace';
const xmlnsNamespace = 'http://www.w3.org/2000/xmlns/';
const packageMetadata: Record<string, { name: string; attrs: readonly string[] }> = {
  relationship: { name: 'Relationship', attrs: ['Id', 'Type', 'Target', 'TargetMode'] },
  override: { name: 'Override', attrs: ['PartName', 'ContentType'] },
  default: { name: 'Default', attrs: ['Extension', 'ContentType'] },
};
function decodeEntities(value: string): string {
  return value.replace(/&([^;\s<&]{1,32});|&/g, (full, entity: string | undefined) => {
    const predefined: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity && Object.hasOwn(predefined, entity)) return predefined[entity];
    if (entity && /^(?:#\d+|#x[\da-fA-F]+)$/.test(entity)) {
      const n = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (
        Number.isInteger(n) &&
        (n === 9 ||
          n === 10 ||
          n === 13 ||
          (n >= 32 && n <= 0xd7ff) ||
          (n >= 0xe000 && n <= 0xfffd) ||
          (n >= 0x10000 && n <= 0x10ffff))
      )
        return String.fromCodePoint(n);
    }
    fail('XLSX_XML_UNSUPPORTED', 'Unsupported XML entity. Export a plain values-only workbook.');
  });
}
/** Strict, non-expanding XML lexer: rejects DTD/CDATA, invalid nesting and ambiguous attributes. */
function walkXml(xml: string, visit: (tag: XmlTag) => void, text: (value: string) => void): void {
  const stack: XmlFrame[] = [];
  let p = 0,
    roots = 0;
  while (p < xml.length) {
    if (xml[p] !== '<') {
      const end = xml.indexOf('<', p),
        stop = end < 0 ? xml.length : end;
      const value = decodeEntities(xml.slice(p, stop));
      if (!stack.length && value.trim())
        fail('XLSX_XML_INVALID', 'Text outside the XML document root.');
      text(value);
      p = stop;
      continue;
    }
    if (xml.startsWith('<!--', p)) {
      const end = xml.indexOf('-->', p + 4);
      if (end < 0 || xml.slice(p + 4, end).includes('--'))
        fail('XLSX_XML_INVALID', 'Invalid XML comment.');
      p = end + 3;
      continue;
    }
    if (xml.startsWith('<?xml ', p) && p === 0) {
      const end = xml.indexOf('?>', p);
      if (end < 0 || end > 256) fail('XLSX_XML_INVALID', 'Invalid XML declaration.');
      const declaration = xml.slice(p, end + 2);
      if (
        !/^<\?xml\s+version\s*=\s*(?:"1\.0"|'1\.0')(?:\s+encoding\s*=\s*(?:"UTF-8"|'UTF-8'))?(?:\s+standalone\s*=\s*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>$/i.test(
          declaration,
        )
      )
        fail('XLSX_XML_UNSUPPORTED', 'Only a standard UTF-8 XML 1.0 declaration is accepted.');
      p = end + 2;
      continue;
    }
    if (xml.startsWith('<!', p) || xml.startsWith('<?', p))
      fail('XLSX_XML_UNSUPPORTED', 'DTD, CDATA and processing instructions are not accepted.');
    let end = p + 1,
      quote = '';
    for (; end < xml.length; end++) {
      const c = xml[end];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (end >= xml.length) fail('XLSX_XML_INVALID', 'Unclosed XML tag.');
    let body = xml.slice(p + 1, end);
    const closing = body.startsWith('/'),
      selfClosing = body.endsWith('/');
    if (closing) body = body.slice(1);
    if (selfClosing) body = body.slice(0, -1);
    const match = /^([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)([\s\S]*)$/.exec(body);
    if (!match) fail('XLSX_XML_INVALID', 'Unsupported XML element name.');
    const fullName = match[1],
      name = fullName.split(':').pop()!,
      attrs: Record<string, string> = Object.create(null),
      aliases = new Set<string>();
    const metadata = Object.hasOwn(packageMetadata, name.toLowerCase())
      ? packageMetadata[name.toLowerCase()]
      : undefined;
    // XML names are case-sensitive. Do not let SheetJS's prefix/underscore aliases
    // turn unsupported package metadata into attributes our guard never examined.
    // This is deliberately local: sheet r:id and namespace declarations remain valid.
    if (metadata && name !== metadata.name)
      fail('XLSX_XML_UNSUPPORTED', 'Nonstandard package metadata element names are not accepted.');
    let rest = match[2];
    while (rest.length) {
      if (!rest.trim()) break;
      const a = /^\s+([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(
        rest,
      );
      if (!a || Object.hasOwn(attrs, a[1]))
        fail('XLSX_XML_INVALID', 'Invalid or duplicated XML attribute.');
      const key = a[1],
        raw = a[2] ?? a[3];
      const alias = (
        key.startsWith('xmlns:')
          ? 'xmlns' + key.slice(6)
          : key.includes(':')
            ? key.split(':')[1]
            : key.includes('_') && !key.startsWith('_')
              ? key.split('_')[0]
              : key
      ).toLowerCase();
      if (aliases.has(alias))
        fail('XLSX_XML_INVALID', 'Ambiguous XML attribute aliases are not accepted.');
      aliases.add(alias);
      if (metadata && key !== 'xmlns' && !key.startsWith('xmlns:') && !metadata.attrs.includes(key))
        fail(
          'XLSX_XML_UNSUPPORTED',
          'Package metadata requires standard unprefixed, case-sensitive attribute names.',
        );
      if (encoder.encode(raw).length > XLSX_LIMITS.cellBytes)
        fail('XLSX_XML_LIMIT', 'XML attribute exceeds the 4 KB safety limit.');
      if (raw.includes('>'))
        fail('XLSX_XML_UNSUPPORTED', 'Attribute values must XML-escape greater-than characters.');
      if (
        ['row', 'c', 'dimension', 'mergeCell', 'autoFilter', 'workbookPr'].includes(name) &&
        /^(?:r|ref|t|s|date1904)$/i.test(alias) &&
        (raw.includes('&') || (key !== alias && alias !== 'date1904'))
      )
        fail(
          'XLSX_XML_UNSUPPORTED',
          'Encoded or aliased structural cell attributes are not accepted.',
        );
      if (name === 'workbookPr' && alias === 'date1904' && key !== 'date1904')
        fail(
          'XLSX_XML_UNSUPPORTED',
          'Workbook date epoch requires the canonical date1904 attribute.',
        );
      attrs[key] = decodeEntities(raw);
      rest = rest.slice(a[0].length);
    }
    if (closing) {
      const frame = stack.pop();
      if (selfClosing || Object.keys(attrs).length || frame?.fullName !== fullName)
        fail('XLSX_XML_INVALID', 'XML elements are not correctly nested.');
      visit({ ...frame, ancestors: stack, closing: true });
    } else {
      if (!stack.length && ++roots > 1) fail('XLSX_XML_INVALID', 'Multiple XML document roots.');
      if (stack.length >= XLSX_LIMITS.xmlDepth)
        fail('XLSX_XML_LIMIT', 'XML nesting exceeds the safety limit.');
      // Namespace scope belongs to the element, not the prefix spelling. A child may
      // rebind a prefix or the default namespace without affecting its siblings.
      const namespaces: Record<string, string> = Object.create(stack.at(-1)?.namespaces ?? null);
      for (const [key, value] of Object.entries(attrs)) {
        if (key !== 'xmlns' && !key.startsWith('xmlns:')) continue;
        const prefix = key === 'xmlns' ? '' : key.slice(6);
        if (
          prefix === 'xmlns' ||
          (prefix === 'xml') !== (value === xmlNamespace) ||
          value === xmlnsNamespace ||
          (prefix && !value)
        )
          fail('XLSX_XML_UNSUPPORTED', 'Invalid or reserved XML namespace declaration.');
        namespaces[prefix] = value;
      }
      const prefix = fullName.includes(':') ? fullName.split(':')[0] : '';
      const frame = { name, fullName, attrs, namespace: namespaces[prefix], namespaces };
      visit({ ...frame, ancestors: stack, closing: false });
      if (selfClosing) visit({ ...frame, ancestors: stack, closing: true });
      else stack.push(frame);
    }
    p = end + 1;
  }
  if (stack.length || roots !== 1) fail('XLSX_XML_INVALID', 'Incomplete XML document.');
}
function cellAddress(ref: string): { r: number; c: number } {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref);
  if (!match) fail('XLSX_RANGE', 'Invalid worksheet cell reference.');
  let column = 0;
  for (const c of match[1]) column = column * 26 + c.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column > XLSX_LIMITS.columns || row > XLSX_LIMITS.physicalRows)
    fail(
      'XLSX_RANGE_LIMIT',
      'Worksheet exceeds 80 columns or 20,030 physical rows. Narrow the report, including formatted empty ranges.',
    );
  return { r: row, c: column };
}
function validateXml(
  bytes: Uint8Array,
  partName: string,
): {
  sheetCount: number;
  cells: number;
  sanitized: Uint8Array;
} {
  let xml: string;
  try {
    xml = utf8.decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    fail('XLSX_XML_UNSUPPORTED', 'Only well-formed UTF-8 OOXML is accepted.');
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(xml))
    fail('XLSX_XML_INVALID', 'Invalid XML control character.');
  // Apply cell budgets by element, not filename: relationships can redirect worksheet parts.
  let cells = 0,
    sheetCount = 0,
    currentRow = 0,
    lastColumn = 0,
    aggregateDepth = 0,
    cellBytes = 0;
  let inCell = false,
    valueDepth = 0,
    valueText = '',
    cellType = '',
    valueCount = 0,
    workbookProperties = 0,
    elements = 0,
    styles = 0,
    sharedStrings = 0;
  let inExtensionProperties = false;
  const relationshipsPart = /^(?:_rels\/\.rels|(?:[^/]+\/)*_rels\/[^/]+\.rels)$/.test(partName);
  const contentTypesPart = partName === '[Content_Types].xml';
  if (partName.endsWith('.rels') && !relationshipsPart)
    fail('XLSX_XML_UNSUPPORTED', 'Relationship metadata requires a standard OPC part location.');
  walkXml(
    xml,
    ({ name: tag, namespace, ancestors, attrs, closing }) => {
      // calcChain c is a formula dependency locator, not a worksheet cell.
      // It is inert metadata and never drives evaluation or transaction values.
      if (partName === 'xl/calcChain.xml') {
        if (
          !spreadsheetNamespaces.has(namespace ?? '') ||
          !(
            (tag === 'calcChain' && ancestors.length === 0) ||
            (tag === 'c' && ancestors.length === 1 && ancestors[0].name === 'calcChain')
          )
        )
          fail('XLSX_XML_UNSUPPORTED', 'Unsupported calculation-chain metadata.');
        if (tag === 'c' && !closing) {
          cellAddress(attrs.r ?? '');
          if (
            Object.keys(attrs).some((k) => !['r', 'i', 's', 'l'].includes(k)) ||
            Object.entries(attrs).some(([k, v]) => k !== 'r' && !/^\d+$/.test(v))
          )
            fail('XLSX_XML_UNSUPPORTED', 'Unsupported calculation-chain attributes.');
        }
        return;
      }
      if (!closing) {
        if (
          ++elements > XLSX_LIMITS.xmlElements ||
          (['numFmt', 'xf', 'font', 'fill', 'border'].includes(tag) &&
            ++styles > XLSX_LIMITS.styles) ||
          (tag === 'si' && ++sharedStrings > XLSX_LIMITS.cellsPerSheet)
        )
          fail('XLSX_XML_LIMIT', 'Workbook XML metadata exceeds the bounded import profile.');
        // A scalar worksheet formula is retained as inert evidence. Only the
        // observed native Journal report is allowed through after workbook parsing.
        if (
          tag === 'f' &&
          (!inCell ||
            !spreadsheetNamespaces.has(namespace ?? '') ||
            ancestors.at(-1)?.name !== 'c' ||
            Object.keys(attrs).some((k) => k !== 'xmlns' && !k.startsWith('xmlns:')))
        )
          fail('XLSX_FORMULA', 'Shared, array or nonstandard formulas are unsupported.');
        if (
          /^(?:formula|definedName|calculatedColumnFormula|totalsRowFormula)$/i.test(tag) ||
          (tag.toLowerCase() === 'f' && tag !== 'f')
        )
          fail(
            'XLSX_FORMULA',
            'Formula cells and defined names are not accepted, even when a cached value exists. Export all formulas as values.',
          );
        if (
          /^(?:externalLink|externalReference|externalReferences|oleObject|oleObjects|ddeLink|controls|control|dataConnection|queryTable)$/i.test(
            tag,
          )
        )
          fail(
            'XLSX_ACTIVE_CONTENT',
            'External links, connections and active workbook content are not accepted.',
          );
        if (tag === 'Relationship') {
          if (
            (attrs.TargetMode ?? '').toLowerCase() === 'external' ||
            /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(attrs.Target ?? '') ||
            /(?:vbaProject|externalLink|oleObject|activeX|connections|queryTable|macrosheet|dialogsheet)/i.test(
              attrs.Type ?? '',
            )
          )
            fail(
              'XLSX_EXTERNAL_LINK',
              'External workbook links and data connections are not accepted.',
            );
        }
        // SheetJS/Excel may list unused binary default types; actual non-XML parts are already rejected.
        if (
          tag === 'Override' ||
          (tag === 'Default' && /^(?:xml|rels)$/i.test(attrs.Extension ?? ''))
        ) {
          if (
            /(?:macroEnabled|vbaProject|binary|macrosheet|dialogsheet|activeX|oleObject)/i.test(
              attrs.ContentType ?? '',
            )
          )
            fail(
              'XLSX_ACTIVE_CONTENT',
              'Macro-enabled or binary workbook content is not accepted.',
            );
        }
        // Package metadata has a distinct namespace and location, even in strict
        // OOXML. Keep the local-name active-content checks above as defense in depth.
        if (
          (!ancestors.length &&
            ((relationshipsPart &&
              (tag !== 'Relationships' || namespace !== packageRelationshipsNamespace)) ||
              (contentTypesPart &&
                (tag !== 'Types' || namespace !== packageContentTypesNamespace)))) ||
          (tag === 'Relationships' &&
            (!relationshipsPart ||
              ancestors.length ||
              namespace !== packageRelationshipsNamespace)) ||
          (tag === 'Types' &&
            (!contentTypesPart ||
              ancestors.length ||
              namespace !== packageContentTypesNamespace)) ||
          (tag === 'Relationship' &&
            (!relationshipsPart ||
              namespace !== packageRelationshipsNamespace ||
              ancestors.length !== 1 ||
              ancestors[0].name !== 'Relationships' ||
              ancestors[0].namespace !== packageRelationshipsNamespace)) ||
          ((tag === 'Override' || tag === 'Default') &&
            (!contentTypesPart ||
              namespace !== packageContentTypesNamespace ||
              ancestors.length !== 1 ||
              ancestors[0].name !== 'Types' ||
              ancestors[0].namespace !== packageContentTypesNamespace))
        )
          fail('XLSX_XML_UNSUPPORTED', 'Unsupported package metadata namespace or location.');
        // SheetJS can consume sheetData even beneath an unrecognized document
        // wrapper. Identify that data context by its container, not only its root.
        const dataNamespaceRequired =
          ((tag === 'v' || tag === 't') && aggregateDepth > 0) ||
          spreadsheetDataElements.get(tag)?.has(tag) ||
          ancestors.some((parent) => spreadsheetDataElements.get(parent.name)?.has(tag));
        if (dataNamespaceRequired && !spreadsheetNamespaces.has(namespace ?? ''))
          fail('XLSX_XML_UNSUPPORTED', 'Unsupported spreadsheet data namespace.');
        if (inExtensionProperties)
          fail('XLSX_XML_UNSUPPORTED', 'Workbook extension properties must be empty metadata.');
        if (tag.toLowerCase() === 'workbookpr') {
          if (tag !== 'workbookPr')
            fail('XLSX_XML_UNSUPPORTED', 'Nonstandard workbook property names are not accepted.');
          if (spreadsheetNamespaces.has(namespace ?? '')) {
            if (
              ++workbookProperties > 1 ||
              ancestors.length !== 1 ||
              ancestors[0].name !== 'workbook' ||
              ancestors[0].namespace !== namespace ||
              (attrs.date1904 !== undefined && !/^(?:0|1|true|false)$/.test(attrs.date1904))
            )
              fail('XLSX_DATE', 'Workbook date epoch is invalid or ambiguous.');
          } else {
            // Only the observed, non-date x15 chart-tracking extension is supported.
            // SheetJS strips element namespaces too: never let extension attributes
            // (especially date1904 or its aliases) override the real workbook epoch.
            if (
              namespace !== x15Namespace ||
              ancestors.length !== 3 ||
              ancestors[0].name !== 'workbook' ||
              !spreadsheetNamespaces.has(ancestors[0].namespace ?? '') ||
              ancestors[1].name !== 'extLst' ||
              ancestors[2].name !== 'ext' ||
              ancestors.slice(1).some((parent) => parent.namespace !== ancestors[0].namespace) ||
              ancestors[2].attrs.uri !== x15WorkbookExtension ||
              Object.keys(attrs).some(
                (key) =>
                  key !== 'xmlns' && !key.startsWith('xmlns:') && key !== 'chartTrackingRefBase',
              ) ||
              (attrs.chartTrackingRefBase !== undefined &&
                !/^(?:0|1|true|false)$/.test(attrs.chartTrackingRefBase))
            )
              fail(
                'XLSX_XML_UNSUPPORTED',
                'Unsupported or ambiguous workbook property namespace or extension.',
              );
            inExtensionProperties = true;
          }
        }
        if (tag === 'sheet') {
          if (++sheetCount > XLSX_LIMITS.sheets)
            fail(
              'XLSX_SHEET_LIMIT',
              'Workbook exceeds five sheets. Export only the required data sheets.',
            );
        }
        if (tag === 'row') {
          const row = Number(attrs.r);
          if (
            !/^[1-9]\d{0,4}$/.test(attrs.r ?? '') ||
            !Number.isInteger(row) ||
            row <= currentRow ||
            row > XLSX_LIMITS.physicalRows
          )
            fail(
              'XLSX_RANGE_LIMIT',
              'Worksheet rows must be unique, ordered and within the 20,030 physical-row limit.',
            );
          currentRow = row;
          lastColumn = 0;
        }
        if (tag === 'c') {
          if (inCell) fail('XLSX_XML_INVALID', 'Nested worksheet cells are invalid.');
          inCell = true;
          cellType = attrs.t ?? 'n';
          valueCount = 0;
          if (cellType === 'd')
            fail(
              'XLSX_DATE',
              'ISO datetime cells need a date-only export; timezone interpretation is not guessed.',
            );
          if (!['n', 's', 'str', 'inlineStr', 'b', 'e'].includes(cellType))
            fail('XLSX_CELL_TYPE', 'Unsupported Excel cell type.');
          if (++cells > XLSX_LIMITS.cellsPerSheet)
            fail('XLSX_CELL_LIMIT', 'Worksheet exceeds the 500,000-cell safety limit.');
          const ref = cellAddress(attrs.r ?? '');
          if (ref.r !== currentRow || ref.c <= lastColumn)
            fail(
              'XLSX_RANGE',
              `Worksheet cell addresses must be unique, ordered and agree with the source row (${partName}:${attrs.r}, row ${currentRow}, previous column ${lastColumn}).`,
            );
          lastColumn = ref.c;
        }
        if (['dimension', 'mergeCell', 'autoFilter'].includes(tag) && attrs.ref) {
          const range = attrs.ref.split(':');
          if (range.length > 2) fail('XLSX_RANGE', 'Invalid worksheet range.');
          for (const ref of range) cellAddress(ref);
        }
        if (inCell && tag === 'v') {
          if (++valueCount > 1 || cellType === 'inlineStr')
            fail('XLSX_CELL_VALUE', 'Multiple or incompatible cell values are not accepted.');
          valueDepth++;
          valueText = '';
        }
        if (tag === 'si' || tag === 'c') {
          if (aggregateDepth++)
            fail('XLSX_XML_INVALID', 'Nested cells or shared strings are invalid.');
          cellBytes = 0;
        }
      } else {
        // Check the workbook root after its properties so invalid epoch context keeps
        // the existing, more specific XLSX_DATE diagnostic.
        if (tag === 'workbook' && !ancestors.length && !spreadsheetNamespaces.has(namespace ?? ''))
          fail('XLSX_XML_UNSUPPORTED', 'Unsupported workbook namespace.');
        if (tag === 'workbookPr' && namespace === x15Namespace) inExtensionProperties = false;
        if (inCell && tag === 'v') {
          const value = valueText.trim();
          if (
            cellType === 'n' &&
            value &&
            (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value) ||
              !Number.isFinite(Number(value)) ||
              (Number.isInteger(Number(value)) && !Number.isSafeInteger(Number(value))))
          )
            fail('XLSX_NUMBER', 'Invalid or precision-unsafe numeric cell.');
          if (cellType === 's' && !/^\d+$/.test(value))
            fail('XLSX_CELL_VALUE', 'Invalid shared-string index.');
          if (cellType === 'b' && !/^(?:0|1|true|false)$/.test(value))
            fail('XLSX_CELL_VALUE', 'Invalid boolean cell.');
          valueDepth--;
        }
        if (tag === 'c') inCell = false;
        if (tag === 'si' || tag === 'c') aggregateDepth--;
      }
    },
    (value) => {
      if (inExtensionProperties && value.trim())
        fail('XLSX_XML_UNSUPPORTED', 'Workbook extension properties must be empty metadata.');
      if (valueDepth) valueText += value;
      if (aggregateDepth && (cellBytes += encoder.encode(value).length) > XLSX_LIMITS.cellBytes)
        fail('XLSX_CELL_LIMIT', 'Cell or shared-string content exceeds 4 KB.');
    },
  );
  // SheetJS uses regex-based XML readers; remove already-validated comments to avoid parser differentials.
  return { sheetCount, cells, sanitized: encoder.encode(xml.replace(/<!--[\s\S]*?-->/g, '')) };
}
function loadWorkbook(bytes: Uint8Array, fileName?: string): WorkBook {
  if (fileName && !/\.xlsx$/i.test(fileName))
    fail('XLSX_FORMAT', 'Only .xlsx files are accepted by this importer.');
  const parts = zipParts(bytes),
    files: Record<string, Uint8Array> = Object.create(null);
  let worksheets = 0;
  for (const part of parts) {
    const data = inflatePart(bytes, part);
    if (part.name.endsWith('/')) {
      if (data.length) fail('XLSX_ZIP_INVALID', 'ZIP directory contains data.');
      continue;
    }
    files[part.name] = validateXml(data, part.name).sanitized;
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(part.name) && ++worksheets > XLSX_LIMITS.sheets)
      fail('XLSX_SHEET_LIMIT', 'Workbook exceeds five worksheets.');
  }
  if (
    !files['[Content_Types].xml'] ||
    !files['xl/workbook.xml'] ||
    !files['xl/_rels/workbook.xml.rels'] ||
    !worksheets
  )
    fail('XLSX_FORMAT', 'Workbook is not a supported standard XLSX package.');
  let workbook: WorkBook;
  // Repack validated bytes without compression so SheetJS never processes attacker ZIP metadata.
  try {
    workbook = read(zipSync(files, { level: 0 }), {
      type: 'array',
      raw: true,
      dense: false,
      cellFormula: true,
      sheetStubs: true,
      cellHTML: false,
      cellNF: true,
      cellText: false,
      cellDates: false,
      bookVBA: false,
      bookDeps: false,
      WTF: true,
      nodim: true,
    });
  } catch {
    fail(
      'XLSX_PARSE',
      'Workbook content is malformed or unsupported. Export a values-only XLSX or CSV.',
    );
  }
  if (
    !workbook.SheetNames.length ||
    workbook.SheetNames.length > XLSX_LIMITS.sheets ||
    new Set(workbook.SheetNames).size !== workbook.SheetNames.length
  )
    fail('XLSX_SHEET_LIMIT', 'Workbook must have one to five uniquely named sheets.');
  // SheetJS synthesizes v=0 for a formula with no stored <v>. Restore
  // absence from the validated XML before projecting any source values.
  const worksheetTargets = new Map<string, string>();
  walkXml(
    utf8.decode(files['xl/_rels/workbook.xml.rels']),
    (tag) => {
      if (!tag.closing && tag.name === 'Relationship') {
        const target = tag.attrs.Target ?? '';
        const segments: string[] = target.startsWith('/') ? [] : ['xl'];
        for (const segment of target.split('/')) {
          if (segment === '..') segments.pop();
          else if (segment && segment !== '.') segments.push(segment);
        }
        worksheetTargets.set(tag.attrs.Id, segments.join('/'));
      }
    },
    () => {},
  );
  for (const name of workbook.SheetNames) {
    const descriptor = workbook.Workbook?.Sheets?.find((s) => s.name === name) as
      { id?: string } | undefined;
    const path = worksheetTargets.get(descriptor?.id ?? '');
    if (!path || !files[path]) fail('XLSX_PARSE', 'Cannot bind worksheet source XML.');
    let address = '',
      formula = false,
      valueDepth = false,
      storedValue = '';
    walkXml(
      utf8.decode(files[path]),
      (tag) => {
        if (tag.name === 'c' && !tag.closing) {
          address = tag.attrs.r;
          formula = false;
          storedValue = '';
        }
        if (tag.name === 'f' && !tag.closing) formula = true;
        if (tag.name === 'v') valueDepth = !tag.closing;
        if (tag.name === 'c' && tag.closing && formula && !storedValue.trim()) {
          const cell = workbook.Sheets[name][address];
          if (cell) delete cell.v;
        }
      },
      (text) => {
        if (valueDepth) storedValue += text;
      },
    );
  }
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) fail('XLSX_PARSE', 'Workbook sheet relationship cannot be resolved.');
    let count = 0;
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!')) continue;
      cellAddress(address);
      if (++count > XLSX_LIMITS.cellsPerSheet)
        fail('XLSX_CELL_LIMIT', 'Worksheet exceeds 500,000 cells.');
      const c = cell as CellObject;
      const nativeJournal =
        sheet.A2?.v === 'Transaction Journal' &&
        sheet.A3?.v === 'All Dates' &&
        sheet.B5?.v === 'Transaction date';
      if (c.F !== undefined || (c.f !== undefined && !nativeJournal))
        fail(
          'XLSX_FORMULA',
          'Formula cells outside the supported native Journal profile are not accepted.',
        );
      if (c.l)
        fail(
          'XLSX_EXTERNAL_LINK',
          'Hyperlinks are not accepted in this values-only import profile.',
        );
      if (c.v !== undefined && encoder.encode(String(c.v)).length > XLSX_LIMITS.cellBytes)
        fail('XLSX_CELL_LIMIT', 'Cell exceeds 4 KB.');
    }
    if (sheet['!ref']) for (const address of sheet['!ref'].split(':')) cellAddress(address);
  }
  return workbook;
}
function describe(workbook: WorkBook): XlsxInspection {
  const sheets = workbook.SheetNames.map((name, index) => {
    const ref = workbook.Sheets[name]['!ref'];
    const end = ref ? utils.decode_range(ref).e : null;
    return {
      name,
      rows: end ? end.r + 1 : 0,
      columns: end ? end.c + 1 : 0,
      hidden: Boolean(workbook.Workbook?.Sheets?.[index]?.Hidden),
    };
  });
  return {
    sheets,
    date1904: Boolean(workbook.Workbook?.WBProps?.date1904),
    requiresSheetSelection: sheets.length > 1 || Boolean(sheets[0]?.hidden),
  };
}
export function inspectXlsx(bytes: Uint8Array, fileName?: string): XlsxInspection {
  return describe(loadWorkbook(bytes, fileName));
}
/** Integer calendar arithmetic. Never converts local midnight through a machine timezone. */
export function excelSerialToISO(serial: number, date1904 = false): string {
  if (!Number.isFinite(serial) || serial < (date1904 ? 0 : 1))
    fail('XLSX_DATE', 'Excel date serial is outside the supported calendar range.');
  const day = Math.floor(serial);
  if (!date1904 && day === 60)
    fail('XLSX_DATE', 'Excel serial 60 is the nonexistent date 1900-02-29. Export a valid date.');
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const date = new Date(epoch + (day - (!date1904 && day > 60 ? 1 : 0)) * 86_400_000);
  if (!Number.isFinite(date.valueOf()) || date.getUTCFullYear() > 9999)
    fail('XLSX_DATE', 'Excel date is outside the supported calendar range.');
  return date.toISOString().slice(0, 10);
}
function cellText(cell: CellObject | undefined, date1904: boolean): string {
  if (!cell || cell.t === 'z' || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'e')
    fail('XLSX_CELL_ERROR', 'Workbook contains an Excel error cell. Correct it before import.');
  if (cell.t === 'd')
    fail(
      'XLSX_DATE',
      'ISO datetime cells need an explicit date-only export; timezone interpretation is not guessed.',
    );
  if (cell.t === 'n') {
    if (typeof cell.v !== 'number' || !Number.isFinite(cell.v))
      fail('XLSX_NUMBER', 'Workbook contains an invalid numeric cell.');
    if (typeof cell.z === 'string' && SSF.is_date(cell.z)) {
      const format = cell.z.replace(/"[^\"]*"|\\.|\[[^\]]*\]/g, '');
      if (!/[yd]/i.test(format))
        fail('XLSX_DATE', 'Time-only cells cannot be imported as transaction dates.');
      return excelSerialToISO(cell.v, date1904);
    }
    return String(cell.v); // Do not round amounts using Excel display formatting.
  }
  if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
  return String(cell.v);
}
export async function readXlsxMatrix(
  bytes: Uint8Array,
  options: { sheetName?: string; fileName?: string } = {},
): Promise<{
  records: MatrixRecord[];
  inspection: XlsxInspection;
  source: { fileHash: string; sheet: string; byteLength: number; parserVersion: string };
}> {
  const workbook = loadWorkbook(bytes, options.fileName),
    inspection = describe(workbook);
  if (!options.sheetName && inspection.requiresSheetSelection)
    fail(
      'XLSX_SHEET_SELECTION',
      'Select a worksheet explicitly; multi-sheet or hidden-sheet workbooks are never silently combined.',
    );
  const name = options.sheetName ?? inspection.sheets[0].name;
  if (!workbook.SheetNames.includes(name))
    fail('XLSX_SHEET_SELECTION', 'The selected worksheet does not exist.');
  const sheet = workbook.Sheets[name],
    info = inspection.sheets.find((s) => s.name === name)!;
  if (!info.rows || !info.columns) fail('XLSX_EMPTY', 'The selected worksheet is empty.');
  const records: MatrixRecord[] = [];
  for (let r = 0; r < info.rows; r++) {
    const values: string[] = [],
      raw: unknown[] = [],
      formulaCells: NonNullable<MatrixRecord['formulaCells']> = [];
    for (let c = 0; c < info.columns; c++) {
      const address = utils.encode_cell({ r, c }),
        cell = sheet[address] as CellObject | undefined;
      if (cell?.f !== undefined)
        formulaCells.push({
          address,
          column: c,
          formula: cell.f,
          cachedValue:
            cell.t === 'e'
              ? null
              : cell.v instanceof Date
                ? cell.v.toISOString()
                : (cell.v ?? null),
        });
      values.push(
        cell?.f !== undefined && cell.t === 'e' ? '' : cellText(cell, inspection.date1904),
      );
      raw.push(
        cell
          ? {
              address,
              type: cell.t,
              value: cell.v ?? null,
              numberFormat: cell.z ?? null,
              formula: cell.f ?? null,
            }
          : null,
      );
    }
    records.push({ values, physicalRow: r + 1, raw: canonicalJson(raw), formulaCells });
  }
  return {
    records,
    inspection,
    source: {
      fileHash: await sha256(bytes),
      sheet: name,
      byteLength: bytes.length,
      parserVersion: 'xlsx-local-1.3/sheetjs-0.20.3',
    },
  };
}
export async function parseXlsx<K extends SourceKind>(
  bytes: Uint8Array,
  kind: K,
  options: XlsxOptions,
): Promise<ParseResult<RowByKind[K]>> {
  try {
    if (bytes.length + (options.existingTotalBytes ?? 0) > IMPORT_LIMITS.totalBytes)
      fail('XLSX_WORKSPACE_LIMIT', 'Files exceed the 30 MB workspace limit.');
    const { records, source } = await readXlsxMatrix(bytes, options);
    if (
      records.some((r) => r.formulaCells?.length) &&
      options.profile !== 'qbo-transaction-journal-v1'
    )
      fail(
        'XLSX_FORMULA',
        'Select the explicit QBO Transaction Journal profile to classify native formulas; cached values are not transaction evidence.',
      );
    return await parseMatrix(records, kind, options, source);
  } catch (error) {
    return {
      status: 'BLOCKED',
      ok: false,
      rows: [],
      manifest: null,
      mapping: null,
      duplicate: false,
      issues: [
        {
          code: error instanceof XlsxImportError ? error.code : 'XLSX_IMPORT_BLOCKED',
          message: error instanceof Error ? error.message : 'XLSX import failed.',
          severity: 'error',
        },
      ],
      controls: { signedCents: 0, debitCents: null, creditCents: null, excludedRows: [] },
    };
  }
}
