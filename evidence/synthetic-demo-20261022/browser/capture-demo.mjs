// Real-browser acceptance for Reconciliation Desk (synthetic data only).
// Runs headless Google Chrome WITH its sandbox (no --no-sandbox) as an unprivileged
// user against a loopback-only `vite preview` server. Usage:
//   QA_IN=<inputs dir> QA_OUT=<output dir> node qa-run.mjs
import { chromium } from '/opt/codex/cua_node/lib/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4173/';
const IN = process.env.QA_IN;
const OUT = process.env.QA_OUT;
const input = (name) => path.join(IN, name);
const out = (name) => path.join(OUT, name);
const results = [];
const counters = { clicks: 0, fills: 0, selects: 0, checks: 0, uploads: 0 };
const network = new Set();
const consoleErrors = [];
function record(id, status, detail) {
  results.push({ id, status, detail });
  console.log(`${status.padEnd(7)} ${id} ${detail ?? ''}`);
}
async function check(id, fn) {
  try {
    const detail = await fn();
    record(id, 'PASS', detail);
  } catch (e) {
    record(id, 'FAIL', String(e?.message ?? e).split('\n')[0]);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
function watch(page, label) {
  page.on('request', (r) => network.add(`${label} ${r.method()} ${r.url().split('?')[0]}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${label}: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`${label} pageerror: ${e.message}`));
}
const click = async (loc) => {
  counters.clicks++;
  await loc.click();
};
const fill = async (loc, v) => {
  counters.fills++;
  await loc.fill(v);
};
const select = async (loc, v) => {
  counters.selects++;
  await loc.selectOption(v);
};
const tick = async (loc) => {
  counters.checks++;
  await loc.check();
};
// Uploads go through the visible control and the native file chooser, so disabled
// states are respected exactly as for a person (never by writing to hidden inputs).
const upload = async (trigger, files) => {
  counters.uploads++;
  const page = trigger.page();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger.click()]);
  await chooser.setFiles(files);
};
const card = (page, title) =>
  page.locator('.upload-card', { has: page.getByRole('heading', { name: title }) }).locator('button.file-picker');
const labelOf = (page, text) => page.locator('label', { hasText: text }).first();
async function download(page, action, name) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), action()]);
  const target = out(name ?? d.suggestedFilename());
  await d.saveAs(target);
  return { file: target, suggested: d.suggestedFilename(), text: fs.readFileSync(target, 'utf8') };
}
async function noHorizontalScroll(page) {
  return page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  chromiumSandbox: true,
  headless: true,
});
const version = browser.version();

// --- Sandbox status ---------------------------------------------------------
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await check('ENV-sandbox', async () => {
    await page.goto('chrome://sandbox');
    const text = await page.locator('body').innerText();
    fs.writeFileSync(out('chrome-sandbox.txt'), text);
    assert(!/--no-sandbox/i.test(process.argv.join(' ')), 'no-sandbox flag present');
    return text.split('\n').slice(0, 6).join(' | ');
  });
  await ctx.close();
}

// --- Desktop: real-file import to approved export ----------------------------
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await desk.newPage();
watch(page, 'desktop');
const t0 = Date.now();
await page.goto(BASE);
await page.screenshot({ path: out('01-landing.png') });
await check('UI-landing-states-scope', async () => {
  const text = await page.locator('main').innerText();
  assert(/Try a sample month/.test(text) && /Use my files/.test(text), 'entry choices missing');
  return 'Demo and own-files entry points are separate';
});

await click(page.getByRole('button', { name: 'Use my files' }));
for (const [title, file] of [
  ['ServiceTitan', 'st_payments.csv'],
  ['QuickBooks', 'qbo_general_ledger.csv'],
  ['Bank', 'bank_activity.csv'],
]) {
  await upload(card(page, title), input(file));
  await page.locator('.upload-card', { hasText: file }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.upload-card button.file-picker:disabled'));
}
await fill(page.getByLabel('Company label'), 'Synthetic HVAC Co');
await fill(page.getByLabel('Bank account label'), 'Collections Checking');
await select(page.getByLabel('QuickBooks report scope'), 'COMPLETE_JOURNAL');
await fill(page.getByLabel('Clearing account, exact GL name'), 'ServiceTitan Clearing');
await fill(page.getByLabel(/QuickBooks bank account, exact GL name/), 'Collections Checking');
await select(page.getByLabel('ServiceTitan export mode'), 'JE_TO_CLEARING');
await tick(page.locator('.quality-confirmation input[type=checkbox]'));
await click(page.getByRole('button', { name: 'Validate files' }));
await check('FLOW-import-validate', async () => {
  await page.getByRole('button', { name: 'Reconcile these files' }).waitFor();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Reconcile these files'))
        ?.disabled,
    null,
    { timeout: 15000 },
  );
  await page.screenshot({ path: out('02-import-validated.png'), fullPage: false });
  return 'three CSVs validated with explicit scope';
});
await click(page.getByRole('button', { name: 'Reconcile these files' }));
await page.getByText('Reconciliation complete').waitFor({ timeout: 20000 });

await click(page.getByRole('button', { name: 'Add evidence' }).first());
await upload(page.getByLabel('Choose a CSV file'), input('processor_settlement.csv'));
await tick(page.locator('dialog input[type=checkbox]'));
await click(page.getByRole('button', { name: 'Validate & add local evidence' }));
await check('FLOW-processor-evidence', async () => {
  await page.getByText('Supporting evidence added').waitFor({ timeout: 20000 });
  return 'processor settlement added and recalculated';
});
const feeRow = page.locator('.queue-list > *', { hasText: 'Settlement fee difference' }).first();
await click(feeRow);
await page.screenshot({ path: out('03-fee-case.png') });
await check('FLOW-engine-case', async () => {
  const text = await page.locator('.case-panel').innerText();
  assert(/Settlement fee difference/.test(text) && /\$10,000\.00/.test(text), 'case heading');
  assert(!/Qb actual bank posting/i.test(text), 'bank posting still listed as missing');
  return 'settlement fee difference on $10,000.00 gross; QB bank leg recognized (not listed as missing)';
});
const preExport = await download(page, () => click(page.getByRole('button', { name: 'Save review project' })), 'save-before-export.review.json');

const openFacts = async () => {
  const details = page.locator('section.case-review details').first();
  if (!(await details.evaluate((d) => d.open))) await click(details.locator('summary'));
};
await openFacts();
const caseReview = page.locator('section.case-review');
await fill(caseReview.getByLabel('Reviewer', { exact: true }), 'Synthetic QA reviewer');
await fill(
  caseReview.getByLabel('Accounting basis / unresolved questions'),
  'Synthetic netted processor fee per settlement SYN-PS-900; not customer data.',
);
for (const [purpose, file] of [
  ['SETTLEMENT', 'synthetic-settlement-review.txt'],
  ['COA', 'synthetic-coa-review.txt'],
  ['LEDGER', 'synthetic-ledger-review.txt'],
]) {
  await select(caseReview.getByLabel('Document purpose'), purpose);
  await upload(caseReview.getByLabel('Attach a locally reviewed supporting document'), input(file));
  await caseReview.getByText(new RegExp(`^${purpose}: `)).waitFor();
}
const accounts = ['ServiceTitan Clearing', 'Accounts Receivable', 'Collections Checking', 'Merchant Processing Fees'];
await fill(caseReview.getByLabel(/Exact accounts covered by reviewed full GL/), accounts.join('\n'));
await fill(caseReview.getByLabel('Reviewed GL coverage starts'), '2026-09-01');
await fill(caseReview.getByLabel('Reviewed GL coverage ends'), '2026-09-30');
await fill(caseReview.getByLabel('Existing bank account full name'), 'Collections Checking');
await fill(caseReview.getByLabel('Existing ordinary asset clearing full name'), 'ServiceTitan Clearing');
await fill(caseReview.getByLabel('Existing fee expense account full name'), 'Merchant Processing Fees');
const types = {
  'ServiceTitan Clearing': 'OTHER_CURRENT_ASSET',
  'Accounts Receivable': 'OTHER',
  'Collections Checking': 'BANK',
  'Merchant Processing Fees': 'EXPENSE',
};
for (const [name, type] of Object.entries(types)) {
  await select(caseReview.getByLabel(`COA type ${name}`), type);
  const row = caseReview.locator('div', { has: page.getByLabel(`COA type ${name}`) }).last();
  await tick(row.getByLabel('Exists in reviewed COA'));
  await select(caseReview.getByLabel(`UF status ${name}`), 'NOT_UF');
}
await select(caseReview.getByLabel('Posted gross-receipt transaction'), 'SYN-QB-R900');
await select(caseReview.getByLabel('Posted net-bank settlement transaction'), 'SYN-QB-D900');
await fill(caseReview.getByLabel(/Documented net fee in USD/), '900.00');
await select(caseReview.getByLabel('Fee mode'), 'NETTED');
for (const label of [
  /I reviewed the actual COA/,
  /Selected clearing is ordinary asset clearing/,
  /The supplied GL includes complete relevant/,
  /Source evidence identifies this entire amount/,
  /I checked all fee journals/,
  /The selected accounting period is open/,
])
  await tick(caseReview.getByLabel(label));
await click(caseReview.getByRole('button', { name: 'Build supported fee-only draft' }));
await check('FLOW-build-draft-from-parsed-files', async () => {
  await caseReview.getByRole('heading', { name: /^DRAFT · RD/ }).waitFor({ timeout: 10000 });
  const text = await caseReview.innerText();
  assert(/Merchant Processing Fees · Debit \$900\.00 · Credit \$0\.00/.test(text), 'fee line');
  assert(/ServiceTitan Clearing · Debit \$0\.00 · Credit \$900\.00/.test(text), 'clearing line');
  await page.screenshot({ path: out('04-draft.png') });
  return 'exactly Dr fee 900 / Cr clearing 900 from parsed CSV files';
});
await tick(caseReview.getByLabel(/I reviewed these exact accounts, date, amounts/));
await click(caseReview.getByRole('button', { name: 'Approve exact proposal' }));
await caseReview.getByRole('heading', { name: /^APPROVED · RD/ }).waitFor({ timeout: 10000 });
const approvedSave = await download(page, () => click(page.getByRole('button', { name: 'Save review project' })), 'save-approved-before-export.review.json');
let csv, manifest;
await check('FLOW-export-bytes', async () => {
  const downloads = [];
  page.on('download', (d) => downloads.push(d));
  await click(caseReview.getByRole('button', { name: 'Download approved QBO CSV' }));
  await page.waitForTimeout(1500);
  assert(downloads.length === 2, `expected 2 downloads, got ${downloads.length}`);
  for (const d of downloads) await d.saveAs(out(d.suggestedFilename()));
  const names = downloads.map((d) => d.suggestedFilename());
  csv = fs.readFileSync(out(names.find((n) => n.endsWith('.csv'))), 'utf8');
  manifest = JSON.parse(fs.readFileSync(out(names.find((n) => n.endsWith('.manifest.json'))), 'utf8'));
  const lines = csv.trim().split(/\r?\n/);
  assert(lines.length === 3, 'expected header + 2 lines');
  assert(lines[1].includes('Merchant Processing Fees') && lines[1].includes(',900.00,'), 'debit');
  assert(lines[2].includes('ServiceTitan Clearing') && /,900\.00$/.test(lines[2]), 'credit');
  assert(!csv.includes('Collections Checking'), 'bank debited again');
  assert(manifest.status === 'EXPORTED_NOT_POSTED' && manifest.synthetic_only === false, 'manifest');
  await page.screenshot({ path: out('05-after-export.png') });
  return `${names.join(' + ')}; 2 balanced lines, no bank leg; manifest ${manifest.status}`;
});
await check('FLOW-repeat-export-blocked', async () => {
  assert(await caseReview.getByRole('button', { name: 'Download approved QBO CSV' }).isDisabled(), 'enabled');
  const text = await caseReview.innerText();
  assert(/Accounting file already recorded: RD/.test(text), 'guidance missing');
  return 'button disabled; guidance names the journal number and what to check';
});

await desk.close();
async function importedPage(ctx,qb,mode='JE_TO_CLEARING',keyboard=false){
 const p=await ctx.newPage(); watch(p,keyboard?'keyboard-import':qb);await p.goto(BASE);
 async function focus(loc){for(let n=0;n<100;n++){if(await loc.evaluate(el=>el===document.activeElement))return;await p.keyboard.press('Tab');}throw Error('Control not reachable in 100 Tabs');}
 const act=async loc=>{if(keyboard){await focus(loc);await p.keyboard.press('Enter');}else await click(loc);};
 const val=async(loc,v)=>{if(keyboard){await focus(loc);await p.keyboard.press('Control+A');await p.keyboard.type(v);}else await fill(loc,v);};
 const pick=async(loc,v)=>{if(keyboard){await focus(loc);await p.keyboard.press('Home');for(let n=0;n<15;n++){if(await loc.inputValue()===v)return;await p.keyboard.press('ArrowDown');}throw Error('Keyboard select option unavailable');}else await select(loc,v);};
 await act(p.getByRole('button',{name:'Use my files'}));
 for(const [title,file]of [['ServiceTitan','st_payments.csv'],['QuickBooks',qb],['Bank','bank_activity.csv']]){
  if(keyboard){await focus(card(p,title));const[fc]=await Promise.all([p.waitForEvent('filechooser'),p.keyboard.press('Space')]);await fc.setFiles(input(file));}else await upload(card(p,title),input(file));
  await p.locator('.upload-card',{hasText:file}).waitFor(); await p.waitForFunction(()=>!document.querySelector('.upload-card button.file-picker:disabled'));
 }
 await val(p.getByLabel('Company label'),'Synthetic native browser review');await val(p.getByLabel('Bank account label'),'Collections Checking');
 await pick(p.getByLabel('QuickBooks report scope'),'ACCOUNT_ACTIVITY');
 await val(p.getByLabel('Clearing account, exact GL name'),mode==='PAYMENT_TO_UF'?'Undeposited Funds':'ServiceTitan Clearing');
 await val(p.getByLabel(/QuickBooks bank account, exact GL name/),'Collections Checking');await pick(p.getByLabel('ServiceTitan export mode'),mode);
 if(keyboard){await focus(p.locator('.quality-confirmation input[type=checkbox]'));await p.keyboard.press('Space');}else await tick(p.locator('.quality-confirmation input[type=checkbox]'));
 await act(p.getByRole('button',{name:'Validate files'}));await p.getByRole('button',{name:'Reconcile these files'}).waitFor();
 await p.screenshot({path:out(`${qb}-mapping.png`),fullPage:true});
 await act(p.getByRole('button',{name:'Reconcile these files'}));await p.getByText('Reconciliation complete').waitFor({timeout:20000});
 if(!keyboard){await click(p.getByRole('button',{name:'Add evidence'}).first());await upload(p.getByLabel('Choose a CSV file'),input('processor_settlement.csv'));await tick(p.locator('dialog input[type=checkbox]'));await click(p.getByRole('button',{name:'Validate & add local evidence'}));await p.getByText('Supporting evidence added').waitFor();}
 return p;
}

{ const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await check('EXTRA-UF-full-click-flow',async()=>{
  const p=await importedPage(ctx,'qbo_uf_ledger.csv','PAYMENT_TO_UF');await click(p.locator('.queue-list > *').first());
  const r=p.locator('section.case-review');await click(r.locator('details').first().locator('summary'));
  await click(p.getByText('UF candidate / reviewed deposit worksheet',{exact:true}));
  const cand=await download(p,()=>click(p.getByRole('button',{name:'Download UF review worksheet'})),'uf-candidate.json');
  await click(p.getByRole('button',{name:'Add actual QB Payment'}));await fill(p.getByLabel('QB Payment ID 1'),'SYN-QB-P900');await fill(p.getByLabel('Payment amount USD 1'),'10000.00');await fill(p.getByLabel('Payment status evidence 1'),'Synthetic reviewed UF payment source row 2');await tick(p.getByLabel('Reviewed: still in UF, not already deposited'));
  for(const [purpose,file] of [['COA','uf-coa.txt'],['SETTLEMENT','uf-settlement.txt'],['LEDGER','uf-ledger.txt']]){await select(r.getByLabel('Document purpose'),purpose);await upload(r.getByLabel('Attach a locally reviewed supporting document'),input(file));await r.getByText(new RegExp(`^${purpose}: `)).waitFor();}
  await fill(r.getByLabel('Existing bank account full name'),'Collections Checking');await fill(r.getByLabel('Existing fee expense account full name'),'Merchant Processing Fees');
  for(const [name,type]of [['Collections Checking','BANK'],['Merchant Processing Fees','EXPENSE']]){await select(r.getByLabel(`COA type ${name}`),type);const row=r.locator('div',{has:p.getByLabel(`COA type ${name}`)}).last();await tick(row.getByLabel('Exists in reviewed COA'));await select(r.getByLabel(`UF status ${name}`),'NOT_UF');}
  await fill(r.getByLabel(/Exact accounts covered by reviewed full GL/),'Undeposited Funds\nAccounts Receivable\nCollections Checking\nMerchant Processing Fees');
  await fill(r.getByLabel('Reviewed GL coverage starts'),'2026-09-01');await fill(r.getByLabel('Reviewed GL coverage ends'),'2026-09-30');await fill(r.getByLabel(/Documented net fee in USD/),'900.00');await select(r.getByLabel('Fee mode'),'NETTED');
  for(const label of [/I reviewed the actual COA/,/The supplied GL includes complete relevant/,/Source evidence identifies this entire amount/,/I checked all fee journals/])await tick(r.getByLabel(label));
  const reviewed=await download(p,()=>click(p.getByRole('button',{name:'Download UF review worksheet'})),'uf-reviewed.json');await p.screenshot({path:out('uf-full-click-reviewed.png'),fullPage:true});fs.writeFileSync(out('uf-visible-state.txt'),await r.innerText());
  assert(JSON.parse(cand.text).status==='CANDIDATE','candidate status');const result=JSON.parse(reviewed.text);assert(result.status==='REVIEWED_INSTRUCTIONS',JSON.stringify(result.missingEvidence));assert(result.importEligible===false,'UF import improperly allowed');return 'Complete UF import/evidence/review/payments flow: CANDIDATE → REVIEWED_INSTRUCTIONS worksheet; never accounting import and no QBO write.';
 });
 await ctx.close();
}

const sample=await browser.newContext({viewport:{width:1440,height:1000}});const p=await sample.newPage();watch(p,'sample');await p.goto(BASE);await p.getByRole('button',{name:'Try a sample month'}).click();await p.getByText('Reconciliation complete').waitFor();await p.screenshot({path:out('08-sample-overview.png')});fs.writeFileSync(out('sample-visible.txt'),await p.locator('main').innerText());
const rows=p.locator('.queue-list > *');const rowTexts=await rows.allTextContents();fs.writeFileSync(out('sample-rows.json'),JSON.stringify(rowTexts,null,2));
for(const [name,pattern] of [['09-clean',/Clean match|Verified three-way/i],['10-ambiguous',/Ambiguous/i]]){await check(name,async()=>{const idx=rowTexts.findIndex(t=>pattern.test(t));assert(idx>=0,'sample case not found');await rows.nth(idx).click();await p.screenshot({path:out(name+'.png')});fs.writeFileSync(out(name+'.txt'),await p.locator('.case-panel').innerText());return 'Actual built-in synthetic sample selected through visible queue';});}
await sample.close();await browser.close();fs.writeFileSync(out('demo-browser-results.json'),JSON.stringify({at:new Date().toISOString(),version,results,network:[...network],consoleErrors},null,2));if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
