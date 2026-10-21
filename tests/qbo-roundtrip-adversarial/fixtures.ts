/**
 * Independent tests only. The two untouched exports are real QBO observations
 * of a synthetic public-demo posting. Every modified/generated matrix here is
 * synthetic adversarial input, not a further observed QBO report/version.
 */
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { utils, write } from 'xlsx';
import type { FeeProposal } from '../../src/export';
import type { ParseOptions } from '../../src/ingestion';

const evidence = new URL('../../evidence/quickbooks-acceptance-20261021/', import.meta.url);
export const nativeCsvBytes = new Uint8Array(
  readFileSync(new URL('target-transaction-journal-145.csv', evidence)),
);
export const nativeCsv = new TextDecoder().decode(nativeCsvBytes);
export const nativeXlsxBytes = new Uint8Array(
  readFileSync(new URL('target-transaction-journal-145.xlsx', evidence)),
);
export const nativeProposal: FeeProposal = JSON.parse(
  readFileSync(new URL('target-synthetic-proposal.json', evidence), 'utf8'),
);
export const options: ParseOptions = {
  companyId: nativeProposal.feeCase.companyId,
  bankAccountId: 'BANK',
  companyTimezone: 'Etc/UTC',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  asOfDate: '2026-10-21',
  currency: 'USD',
  profile: 'qbo-transaction-journal-v1',
  qboTransactionJournalCompanyName: "Craig's Design and Landscaping Services",
  dateFormat: 'MDY',
  postedLedgerConfirmed: true,
  coverageConfirmed: false,
  accountMap: {
    'Bank Charges': { accountType: 'EXPENSE', role: 'FEE', isUndepositedFunds: false },
    'Uncategorized Asset': {
      accountType: 'OTHER_CURRENT_ASSET',
      role: 'CLEARING',
      isUndepositedFunds: false,
    },
  },
};
export function matrix(): string[][] {
  const rows = Papa.parse<string[]>(nativeCsv, { skipEmptyLines: false }).data;
  while (rows.at(-1)?.every((cell) => cell === '')) rows.pop();
  return rows;
}
export function syntheticCsv(change: (rows: string[][]) => void = () => {}): string {
  const rows = matrix();
  change(rows);
  return Papa.unparse(rows, { newline: '\r\n' }) + '\r\n';
}
export function syntheticValuesOnlyXlsx(rows = matrix()): Uint8Array {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), 'Synthetic Values Only');
  return new Uint8Array(write(book, { type: 'array', bookType: 'xlsx', compression: true }));
}
export function secondGroup(rows: string[][], id = '981', num = 'SYNTHETIC-SECOND'): void {
  const group = rows.slice(5, 9).map((row) => [...row]);
  group[0][0] = id;
  group[1][3] = num;
  group[2][3] = num;
  group[3][0] = `Total for ${id}`;
  rows.splice(9, 0, ...group);
  rows[13][7] = '$1,800.00';
  rows[13][8] = '$1,800.00';
}
