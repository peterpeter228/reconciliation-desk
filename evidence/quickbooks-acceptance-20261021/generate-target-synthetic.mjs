import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { approveProposal, buildFeeProposal, createTeachingFeeCase, exportQboCsv } from '../../src/export/index.ts';
// Pure synthetic acceptance fixture. NOT accountant approval or real ledger evidence.
const c = createTeachingFeeCase();
c.caseId = 'PUBLIC_TESTDRIVE_NATIVE_CSV_ACCEPTANCE_20261021';
c.mappingVersion = 'public-demo-existing-accounts-20261021-v1';
const names = { BANK: 'Checking', CLEARING: 'Uncategorized Asset', FEES: 'Bank Charges', AR: 'Accounts Receivable (A/R)' };
c.accounts = c.accounts.map(a => ({...a, name:names[a.id] ?? a.name}));
const p = await approveProposal(await buildFeeProposal(c), 'Synthetic Fixture Generator - NOT accountant approval', '2026-10-21T11:28:00.000Z');
const artifact = await exportQboCsv(p);
const dir = new URL('./', import.meta.url);
await fs.writeFile(new URL('target-synthetic-proposal.json', dir), JSON.stringify(p,null,2)+'\n');
await fs.writeFile(new URL('target-synthetic-export-manifest.json', dir), JSON.stringify(artifact.manifest,null,2)+'\n');
const fileName = `PUBLIC_DEMO_ONLY_${p.journalId}.csv`;
await fs.writeFile(new URL(fileName, dir), artifact.content);
const sha = createHash('sha256').update(artifact.content).digest('hex');
await fs.writeFile(new URL('target-synthetic-sha256.txt',dir), `${sha}  ${fileName}\n`);
console.log(JSON.stringify({fileName,sha,journalId:p.journalId,lines:p.lines},null,2));
