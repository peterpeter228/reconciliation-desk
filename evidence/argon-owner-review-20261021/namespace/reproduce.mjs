import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { read, utils, write } from 'xlsx';
import { inspectXlsx, readXlsxMatrix } from '../../../src/ingestion/xlsx.ts';

// Optional baseline is the untouched xlsx.ts from reviewed revision 44b996e.
// All package imports resolve to the already installed local dependencies.
const baselinePath = process.argv[2];
const sourceUrl = new URL('../../../src/ingestion/xlsx.ts', import.meta.url);
let baseline;
let baselineHash;
if (baselinePath) {
  const source = readFileSync(baselinePath, 'utf8');
  baselineHash = createHash('sha256').update(source).digest('hex');
  const compiled = transpileModule(source, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText.replace(/from ['"]([^'"]+)['"]/g, (_, specifier) => {
    const resolved = specifier.startsWith('.')
      ? new URL(`${specifier}.ts`, sourceUrl).href
      : import.meta.resolve(specifier);
    return `from ${JSON.stringify(resolved)}`;
  });
  baseline = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const book = utils.book_new();
utils.book_append_sheet(book, utils.aoa_to_sheet([['Date', 'Amount'], ['2026-09-01', 900]]), 'Data');
const source = new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' }));
const packageNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const contentNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types';
const modifications = [
  ['foreign cell default namespace', 'xl/worksheets/sheet1.xml', xml => xml.replace('<c r="B2"', '<c xmlns="urn:spoof" r="B2"')],
  ['reported foreign prefixed c/v shape', 'xl/worksheets/sheet1.xml', xml => xml.replace('<c r="B2"><v>900</v></c>', '<spoof:c xmlns:spoof="urn:custom" r="B2" t="n"><spoof:v>900</spoof:v></spoof:c>')],
  ['foreign value namespace', 'xl/worksheets/sheet1.xml', xml => xml.replace('<v>900</v>', '<v xmlns="urn:spoof">900</v>')],
  ['foreign sheet namespace', 'xl/workbook.xml', xml => xml.replace('<sheet name=', '<custom:sheet xmlns:custom="urn:spoof" name=')],
  ['foreign relationship root', 'xl/_rels/workbook.xml.rels', xml => xml.replace(packageNamespace, 'urn:spoof')],
  ['foreign Relationship child', 'xl/_rels/workbook.xml.rels', xml => xml.replace('<Relationship ', '<Relationship xmlns="urn:spoof" ')],
  ['foreign Override child', '[Content_Types].xml', xml => xml.replace('<Override ', '<Override xmlns="urn:spoof" ')],
  ['foreign Default child', '[Content_Types].xml', xml => xml.replace('<Default ', '<Default xmlns="urn:spoof" ')],
  ['foreign content-types root', '[Content_Types].xml', xml => xml.replace(contentNamespace, 'urn:spoof')],
  ['misplaced inert Relationship', 'xl/worksheets/sheet1.xml', xml => xml.replace('</worksheet>', `<Relationship xmlns="${packageNamespace}" Id="unused" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="sheet1.xml"/></worksheet>`)],
  ['misplaced inert Override', 'xl/worksheets/sheet1.xml', xml => xml.replace('</worksheet>', `<Override xmlns="${contentNamespace}" PartName="/docProps/unused.xml" ContentType="application/xml"/></worksheet>`)],
  ['foreign cell under unknown worksheet wrapper', 'xl/worksheets/sheet1.xml', xml => xml.replace('<worksheet ', '<unknown ').replace('</worksheet>', '</unknown>').replace('<c r="B2"', '<c xmlns="urn:spoof" r="B2"').replace('<v>900</v>', '<v xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">900</v>')],
  ['foreign cell under recognized but wrong workbook wrapper', 'xl/worksheets/sheet1.xml', xml => xml.replace('<worksheet ', '<workbook ').replace('</worksheet>', '</workbook>').replace('<c r="B2"', '<custom:c xmlns:custom="urn:spoof" r="B2"').replace('<v>900</v></c>', '<v>900</v></custom:c>')],
];
async function guarded(input, parser) {
  try {
    const parsed = await parser(input);
    return { accepted: true, amount: parsed.records[1].values[1] };
  } catch (error) {
    return { accepted: false, code: error.code };
  }
}
const observations = [];
for (const [name, path, change] of modifications) {
  const parts = unzipSync(source);
  const before = strFromU8(parts[path]);
  const after = change(before);
  if (before === after) throw new Error(`Mutation did not apply: ${name}`);
  parts[path] = strToU8(after);
  const input = zipSync(parts, { level: 0 });
  let sheetjs;
  try {
    const raw = read(input, { type: 'array', WTF: true });
    sheetjs = { accepted: true, sheets: raw.SheetNames, amount: raw.Sheets.Data.B2.v };
  } catch (error) {
    sheetjs = { accepted: false, message: error.message };
  }
  observations.push({
    name,
    ...(baseline ? { before: await guarded(input, baseline.readXlsxMatrix) } : {}),
    sheetjs,
    after: await guarded(input, readXlsxMatrix),
  });
}
const nativeUrl = new URL('../../quickbooks-acceptance-20261021/target-transaction-journal-145.xlsx', import.meta.url);
const nativeBytes = new Uint8Array(readFileSync(nativeUrl));
let nativeCode;
try { inspectXlsx(nativeBytes); } catch (error) { nativeCode = error.code; }
console.log(JSON.stringify({
  evidenceDate: '2026-10-21',
  reviewedRevision: '44b996e74aa718d7276b325157204cf624af7f12',
  baselineSourceSha256: baselineHash,
  patchedSourceSha256: createHash('sha256').update(readFileSync(fileURLToPath(sourceUrl))).digest('hex'),
  observations,
  nativeQbo: { bytes: nativeBytes.length, sha256: createHash('sha256').update(nativeBytes).digest('hex'), rejection: nativeCode },
  scope: 'Local synthetic parsing only; no formula execution, network exploit, remote model, credentials, browser or deployment tested.',
}, null, 2));
