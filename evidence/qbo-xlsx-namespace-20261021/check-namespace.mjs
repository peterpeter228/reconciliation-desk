// Local synthetic diagnostics only. Never edit or sanitize the captured QBO XLSX.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import { utils, write } from 'xlsx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { inspectXlsx, readXlsxMatrix } from '../../src/ingestion/xlsx.ts';
const out = new URL('./', import.meta.url);
const original = new URL('../quickbooks-acceptance-20261021/target-transaction-journal-145.xlsx', out);
const csv = new URL('../quickbooks-acceptance-20261021/target-transaction-journal-145.csv', out);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nativeBytes = await fs.readFile(original);
const nativeHash = hash(nativeBytes);
if (nativeHash !== 'ac1b896b3377199496c67132968e8e61949f388eaa7a13c43ed52fcace95e033') throw new Error('Captured input hash changed');
const nativeParts = unzipSync(nativeBytes);
const wbXml = strFromU8(nativeParts['xl/workbook.xml']);
const sheetXml = strFromU8(nativeParts['xl/worksheets/sheet1.xml']);
let nativeResult;
try { nativeResult = { accepted: true, inspection: inspectXlsx(nativeBytes) }; }
catch (error) { nativeResult = { accepted: false, code: error.code, message: error.message }; }
const records = Papa.parse(await fs.readFile(csv, 'utf8')).data;
if (records.at(-1).every((value) => value === '')) records.pop();
for (const row of [6, 7, 8, 9]) for (const col of [7, 8]) if (records[row][col]) records[row][col] = Number(records[row][col].replace('$', ''));
const book = utils.book_new();
utils.book_append_sheet(book, utils.aoa_to_sheet(records), 'Sheet1');
const parts = unzipSync(new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' })));
parts['xl/workbook.xml'] = strToU8(strFromU8(parts['xl/workbook.xml']).replace('</workbook>', '<extLst><ext uri="{140A7094-0E35-4892-8432-C4D2E57EDEB5}"><x15:workbookPr xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main" chartTrackingRefBase="1"/></ext></extLst></workbook>'));
const derivedBytes = zipSync(parts, { level: 0 });
const derivedName = 'SYNTHETIC_DERIVED_VALUES_ONLY_NOT_NATIVE.xlsx';
await fs.writeFile(new URL(derivedName, out), derivedBytes);
const matrix = await readXlsxMatrix(derivedBytes, { fileName: derivedName });
const result = {
  scope: 'Local namespace regression only. Original captured QBO XLSX remains unsupported because it contains formulas. The separate derived fixture is newly generated from the companion public-demo CSV, not a sanitized or accepted original XLSX.',
  original: {
    fileName: 'target-transaction-journal-145.xlsx', sha256: nativeHash, bytes: nativeBytes.length,
    epoch: 'Standard workbookPr has no date1904; default 1900 epoch. Posting dates B7/B8 are shared strings, not serials.',
    standardProperties: wbXml.match(/<workbookPr\b[^>]*\/>/)[0],
    extensionProperties: wbXml.match(/<x15:workbookPr\b[^>]*\/>/)[0],
    formulaCells: [...sheetXml.matchAll(/<c\b[^>]*r="([^"]+)"[^>]*>([\s\S]*?)<\/c>/g)].filter((m) => m[2].includes('<f>')).map((m) => ({ address: m[1], formula: m[2].match(/<f>([^<]*)<\/f>/)[1] })),
    result: nativeResult,
    unchangedAfter: hash(await fs.readFile(original)) === nativeHash,
  },
  derived: { fileName: derivedName, nativeExport: false, generatedFrom: 'companion public-demo CSV with numeric amount cells and independently added inert x15 metadata', ...matrix },
};
await fs.writeFile(new URL('namespace-result.json', out), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ original: result.original, derived: { source: matrix.source, inspection: matrix.inspection, rowCount: matrix.records.length } }, null, 2));
