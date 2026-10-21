import fs from 'node:fs/promises';
import { parseSource, parseXlsx } from '../../src/ingestion/index.ts';
import { matchProposalJournalPosting, verifyProposalInLedger } from '../../src/export/index.ts';
const dir = new URL('./', import.meta.url);
const proposal = JSON.parse(await fs.readFile(new URL('target-synthetic-proposal.json', dir), 'utf8'));
const options = {
  companyId: proposal.feeCase.companyId,
  bankAccountId: 'BANK', companyTimezone: 'Etc/UTC', currency: 'USD',
  periodStart: '2026-09-30', periodEnd: '2026-09-30', asOfDate: '2026-10-21',
  profile: 'qbo-transaction-journal-v1',
  qboTransactionJournalCompanyName: "Craig's Design and Landscaping Services",
  headerRow: 5, dateFormat: 'MDY', postedLedgerConfirmed: true, coverageConfirmed: false,
  accountMap: {
    'Bank Charges': { accountType: 'EXPENSE', role: 'FEE', isUndepositedFunds: false },
    'Uncategorized Asset': { accountType: 'OTHER_CURRENT_ASSET', role: 'CLEARING', isUndepositedFunds: false },
  },
};
const result = {
  scope: 'Untouched official public-sample QBO reports. Exact journal-posting match only; NOT full-period reconciliation or clearing-balance verification.',
  profile: options.profile,
  historicalResultPreserved: 'native-roundtrip-result.json',
  source: 'Only the previously authorized synthetic transaction in the public Sample Company; no new external posting, account access, or import.',
};
for (const extension of ['csv', 'xlsx']) {
  const fileName = `target-transaction-journal-145.${extension}`;
  const bytes = await fs.readFile(new URL(fileName, dir));
  const parsed = extension === 'csv'
    ? await parseSource(bytes.toString('utf8'), 'QBO', { ...options, fileName, originalBytes: bytes })
    : await parseXlsx(bytes, 'QBO', { ...options, fileName, sheetName: 'Sheet1' });
  const manifests = parsed.manifest ? [parsed.manifest] : [];
  result[extension] = {
    fileName, ok: parsed.ok, rowCount: parsed.rows.length,
    issues: parsed.issues, mapping: parsed.mapping, controls: parsed.controls,
    manifest: parsed.manifest, rows: parsed.rows,
    exactPostingMatch: await matchProposalJournalPosting(proposal, parsed.rows, manifests),
    fullLedgerVerification: await verifyProposalInLedger(proposal, parsed.rows, manifests),
  };
}
await fs.writeFile(new URL('native-profile-roundtrip-result.json', dir), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.csv.ok || !result.csv.exactPostingMatch.matched || result.csv.fullLedgerVerification.verified || result.xlsx.ok || !result.xlsx.issues.some((i) => i.code === 'XLSX_FORMULA')) process.exitCode = 1;
