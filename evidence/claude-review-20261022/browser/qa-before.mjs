// Same real-file path against the unmodified baseline build (42d677e), synthetic data only.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:4174/', IN = process.env.QA_IN, OUT = process.env.QA_OUT;
const results = [];
const rec = (id, status, detail) => { results.push({ id, status, detail }); console.log(status, id, detail); };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', chromiumSandbox: true, headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const pick = async (trigger, files) => { const [c] = await Promise.all([p.waitForEvent('filechooser'), trigger.click()]); await c.setFiles(files); };
const card = (t) => p.locator('.upload-card', { has: p.getByRole('heading', { name: t }) }).locator('button.file-picker');
await p.goto(BASE);
await p.getByRole('button', { name: 'Use my files' }).click();
for (const [t, f] of [['ServiceTitan','st_payments.csv'],['QuickBooks','qbo_general_ledger.csv'],['Bank','bank_activity.csv']]) {
  await pick(card(t), IN + '/' + f);
  await p.locator('.upload-card', { hasText: f }).waitFor();
  await p.waitForFunction(() => !document.querySelector('.upload-card button.file-picker:disabled'));
}
await p.getByLabel('Company label').fill('Synthetic HVAC Co');
await p.getByLabel('Bank account label').fill('Collections Checking');
await p.getByLabel('QuickBooks report scope').selectOption('COMPLETE_JOURNAL');
await p.getByLabel('Clearing account, exact GL name').fill('ServiceTitan Clearing');
await p.getByLabel('ServiceTitan export mode').selectOption('JE_TO_CLEARING');
await p.locator('.quality-confirmation input[type=checkbox]').check();
await p.getByRole('button', { name: 'Validate files' }).click();
await p.waitForFunction(() => ![...document.querySelectorAll('button')].find((x) => x.textContent?.includes('Reconcile these files'))?.disabled, null, { timeout: 15000 });
await p.getByRole('button', { name: 'Reconcile these files' }).click();
await p.getByText('Reconciliation complete').waitFor({ timeout: 20000 });
await p.getByRole('button', { name: 'Add evidence' }).first().click();
await pick(p.getByLabel('Choose a CSV file'), IN + '/processor_settlement.csv');
await p.locator('dialog input[type=checkbox]').check();
await p.getByRole('button', { name: 'Validate & add local evidence' }).click();
await p.getByText('Supporting evidence added').waitFor({ timeout: 20000 });
await p.locator('.queue-list > *', { hasText: 'Settlement fee difference' }).first().click();
const caseText = await p.locator('.case-panel').innerText();
rec('BEFORE-qb-bank-leg', /Qb actual bank posting/i.test(caseText) ? 'OBSERVED' : 'NOT_OBSERVED', 'desk lists QB bank posting as still needed (no bank GL field at baseline)');
await p.getByText('Review facts & documented fee-only proposal').click();
const cr = p.locator('section.case-review');
await cr.getByLabel('Reviewer', { exact: true }).fill('Synthetic QA reviewer');
await cr.getByLabel('Accounting basis / unresolved questions').fill('Synthetic netted processor fee.');
for (const [purpose, file] of [['SETTLEMENT','synthetic-settlement-review.txt'],['COA','synthetic-coa-review.txt'],['LEDGER','synthetic-ledger-review.txt']]) {
  await cr.getByLabel('Document purpose').selectOption(purpose);
  await pick(cr.getByLabel('Attach a locally reviewed supporting document'), IN + '/' + file);
  await cr.getByText(new RegExp(`^${purpose}: `)).waitFor();
}
const accounts = ['ServiceTitan Clearing', 'Accounts Receivable', 'Collections Checking', 'Merchant Processing Fees'];
await cr.getByLabel(/Exact accounts covered by reviewed full GL/).fill(accounts.join('\n'));
await cr.getByLabel('Reviewed GL coverage starts').fill('2026-09-01');
await cr.getByLabel('Reviewed GL coverage ends').fill('2026-09-30');
await cr.getByLabel('Existing bank account full name').fill('Collections Checking');
await cr.getByLabel('Existing ordinary asset clearing full name').fill('ServiceTitan Clearing');
await cr.getByLabel('Existing fee expense account full name').fill('Merchant Processing Fees');
for (const [name, type] of Object.entries({ 'ServiceTitan Clearing': 'OTHER_CURRENT_ASSET', 'Accounts Receivable': 'OTHER', 'Collections Checking': 'BANK', 'Merchant Processing Fees': 'EXPENSE' })) {
  await cr.getByLabel(`COA type ${name}`).selectOption(type);
  await cr.locator('div', { has: p.getByLabel(`COA type ${name}`) }).last().getByLabel('Exists in reviewed COA').check();
  await cr.getByLabel(`UF status ${name}`).selectOption('NOT_UF');
}
await cr.getByLabel('Posted gross-receipt transaction').selectOption('SYN-QB-R900');
await cr.getByLabel('Posted net-bank settlement transaction').selectOption('SYN-QB-D900');
await cr.getByLabel(/Documented net fee in USD/).fill('900.00');
await cr.getByLabel('Fee mode').selectOption('NETTED');
for (const l of [/I reviewed the actual COA/, /Selected clearing is ordinary/, /The supplied GL includes complete/, /Source evidence identifies/, /I checked all fee journals/, /The selected accounting period is open/]) await cr.getByLabel(l).check();
await cr.getByRole('button', { name: 'Build supported fee-only draft' }).click();
await p.waitForTimeout(1500);
const err = await cr.locator('.notice-error').allInnerTexts();
fs.writeFileSync(OUT + '/before-build-error.txt', err.join('\n'));
await cr.locator('.notice-error').last().scrollIntoViewIfNeeded().catch(() => {});
await p.screenshot({ path: OUT + '/before-01-build-error.png' });
rec('BEFORE-build-from-parsed-files', /too_big|"code"/.test(err.join(' ')) ? 'OBSERVED' : 'NOT_OBSERVED', err.join(' ').slice(0, 300).replace(/\s+/g, ' '));
// Unsaved review edits, then the header demo button.
await p.getByRole('button', { name: 'Reset sample month' }).click();
await p.waitForTimeout(2500);
const heading = await p.locator('.page-heading').innerText();
await p.screenshot({ path: OUT + '/before-02-demo-replaced-workspace.png' });
rec('BEFORE-demo-replaces-unsaved-work', /Synthetic sample/.test(heading) ? 'OBSERVED' : 'NOT_OBSERVED', heading.replace(/\s+/g, ' ').slice(0, 160));
fs.writeFileSync(OUT + '/before-results.json', JSON.stringify({ base: BASE, commit: '42d677e', results }, null, 2));
await b.close();
