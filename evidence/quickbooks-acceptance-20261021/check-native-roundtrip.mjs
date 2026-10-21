import fs from 'node:fs/promises';
import { parseSource, parseXlsx } from '../../src/ingestion/index.ts';
import { verifyProposalInLedger } from '../../src/export/index.ts';
const dir = new URL('./', import.meta.url);
const proposal = JSON.parse(await fs.readFile(new URL('target-synthetic-proposal.json',dir),'utf8'));
const options = {
  companyId: proposal.feeCase.companyId, bankAccountId:'BANK', companyTimezone:'Etc/UTC',
  periodStart:'2026-09-30',periodEnd:'2026-09-30',asOfDate:'2026-10-21',currency:'USD',
  profile:'manual',headerRow:5,dateFormat:'MDY',postedLedgerConfirmed:true,
  // This single-transaction report is not complete account-period coverage.
  coverageConfirmed:false,bindings:{account_full_name:6},
  accountMap:{'Bank Charges':{accountType:'EXPENSE',role:'FEE',isUndepositedFunds:false},'Uncategorized Asset':{accountType:'OTHER_CURRENT_ASSET',role:'CLEARING',isUndepositedFunds:false}},
};
const result = {scope:'Untouched native QBO Transaction Journal exports. No row rewriting, group-ID propagation or invented metadata.',uiObservedTransactionId:'145'};
for (const extension of ['csv','xlsx']) {
  const fileName=`target-transaction-journal-145.${extension}`;
  const bytes=await fs.readFile(new URL(fileName,dir));
  const parsed=extension==='csv'? await parseSource(bytes.toString('utf8'),'QBO',{...options,fileName}) : await parseXlsx(bytes,'QBO',{...options,fileName,sheetName:'Sheet1'});
  const verification=await verifyProposalInLedger(proposal,parsed.rows,parsed.manifest?[parsed.manifest]:[]);
  result[extension]={fileName,ok:parsed.ok,rowCount:parsed.rows.length,issues:parsed.issues,mapping:parsed.mapping,controls:parsed.controls,manifest:parsed.manifest,verification};
}
await fs.writeFile(new URL('native-roundtrip-result.json',dir),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
