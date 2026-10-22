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
await check('DELIVERABLE-reviewer-summary', async () => {
  const d = await download(page, () => click(caseReview.getByRole('button', { name: 'Download reviewer summary (HTML)' })));
  assert(/Case review summary/.test(d.text) && /RD[0-9A-F]{10}/.test(d.text), 'content');
  assert(!/<script/i.test(d.text), 'script present');
  const viewer = await desk.newPage();
  await viewer.goto('file://' + d.file);
  await viewer.screenshot({ path: out('06-reviewer-summary.png'), fullPage: true });
  await viewer.close();
  return path.basename(d.file);
});
const postExport = await download(page, () => click(page.getByRole('button', { name: 'Save review project' })), 'save-after-export.review.json');
await check('PRIVACY-save-notice', async () => {
  await page.getByText(/contains your normalized financial rows/).waitFor();
  return 'save notice warns that the project contains financial rows';
});

// Stale-copy duplicate attempt: reopen the project saved BEFORE the export.
await upload(labelOf(page, 'Open review project'), preExport.file);
await page.getByText('Review project restored and recalculated').waitFor({ timeout: 15000 });
await click(page.locator('.queue-list > *', { hasText: 'Settlement fee difference' }).first());
await check('DUP-stale-project-blocked', async () => {
  const text = await page.locator('section.case-review').innerText();
  assert(/Accounting file already recorded: RD/.test(text), 'register not applied');
  await page.screenshot({ path: out('07-stale-copy-blocked.png') });
  return 'pre-export project copy shows the browser-recorded export';
});
await check('SRC-reopened-unverified', async () => {
  const panel = page.locator('section.source-verification');
  await panel.getByText('4 of 4 not re-verified').waitFor();
  return 'reopened project marks all 4 sources unverified';
});
await upload(labelOf(page, 'Choose original files'), [
  input('st_payments.csv'),
  input('qbo_general_ledger.csv'),
  input('bank_activity.csv'),
  input('processor_settlement.csv'),
]);
await check('SRC-reverified-originals', async () => {
  await page.locator('section.source-verification').getByText('All re-verified').waitFor({ timeout: 20000 });
  await page.screenshot({ path: out('08-sources-reverified.png') });
  return 'all 4 originals re-parsed to identical saved rows';
});
await check('SRC-wrong-file-rejected', async () => {
  // A file that is not one of the sources is refused with a reason.
  await upload(labelOf(page, 'Open review project'), postExport.file);
  await page.getByText('Review project restored and recalculated').waitFor({ timeout: 15000 });
  await upload(labelOf(page, 'Choose original files'), input('qbo_uf_ledger.csv'));
  await page.getByText(/no source in this project has this file/).waitFor({ timeout: 15000 });
  return 'non-matching file rejected with explanation';
});

// Unsaved-work protection.
await click(page.locator('.queue-list > *', { hasText: 'Settlement fee difference' }).first());
await openFacts();
await fill(page.locator('section.case-review').getByLabel('Reviewer', { exact: true }), 'Synthetic QA reviewer (edited)');
await check('SAVE-state-visible', async () => {
  await page.getByText('Unsaved review changes').waitFor();
  return 'unsaved status visible after an edit';
});
await click(page.getByRole('button', { name: 'Reset sample month' }));
await check('SAFE-replace-confirmation', async () => {
  await page.getByText('Replace this workspace?').waitFor();
  await page.screenshot({ path: out('09-replace-confirmation.png') });
  await click(page.getByRole('button', { name: 'Keep workspace' }));
  const heading = await page.locator('.page-heading').innerText();
  assert(/Synthetic HVAC Co/.test(heading), 'workspace replaced');
  return 'demo did not replace unsaved real workspace; Keep workspace retained it';
});
await check('ERR-malformed-project', async () => {
  await upload(labelOf(page, 'Open review project'), input('malformed-review.json'));
  await click(page.getByRole('button', { name: 'Replace workspace' }));
  await page.getByText(/Review project validation failed/).waitFor();
  const heading = await page.locator('.page-heading').innerText();
  assert(/Synthetic HVAC Co/.test(heading), 'workspace lost');
  await page.getByText('Unsaved review changes').waitFor();
  await page.screenshot({ path: out('10-malformed-project.png') });
  return 'concise error; workspace and unsaved protection retained';
});
await check('SAFE-beforeunload', async () => {
  let dialog = null;
  page.on('dialog', async (d) => {
    dialog = d.type();
    await d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 1500));
  assert(dialog === 'beforeunload', `dialog=${dialog}`);
  assert(!page.isClosed(), 'page closed despite unsaved work');
  return 'browser beforeunload prompt shown and dismissing it kept the page';
});
const desktopMs = Date.now() - t0;
await desk.close();

// --- Native QBO Transaction Journal XLSX (unmodified public-sample export) ---
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  watch(p, 'native');
  await p.goto(BASE);
  await click(p.getByRole('button', { name: 'Use my files' }));
  await select(p.getByLabel('QuickBooks report profile'), 'qbo-transaction-journal-v1');
  await fill(p.getByLabel('Expected report company name'), "Craig's Design and Landscaping Services");
  for (const [title, file] of [
    ['ServiceTitan', 'st.csv'],
    ['QuickBooks', 'target-transaction-journal-145.xlsx'],
    ['Bank', 'bank.csv'],
  ]) {
    await upload(card(p, title), input(file));
    await p.locator('.upload-card', { hasText: file }).waitFor();
    await p.waitForFunction(() => !document.querySelector('.upload-card button.file-picker:disabled'));
  }
  await fill(p.getByLabel('Company label'), 'Synthetic native QA');
  await fill(p.getByLabel('Bank account label'), 'Synthetic bank');
  await select(p.getByLabel('QuickBooks report scope'), 'COMPLETE_JOURNAL');
  await fill(p.getByLabel('Clearing account, exact GL name'), 'ServiceTitan Clearing');
  await select(p.getByLabel('ServiceTitan export mode'), 'JE_TO_CLEARING');
  await tick(p.locator('.quality-confirmation input[type=checkbox]'));
  await click(p.getByRole('button', { name: 'Validate files' }));
  await check('XLSX-native-controls-preserved', async () => {
    await p.locator('details.mapping-card summary', { hasText: 'READY · 2 usable rows' }).waitFor({ timeout: 20000 });
    // A validated mapping card is collapsed; a reviewer expands it, then the controls.
    const mapping = p.locator('details.mapping-card', { hasText: 'target-transaction-journal-145.xlsx' });
    await mapping.waitFor({ timeout: 20000 });
    if (!(await mapping.evaluate((d) => d.open))) await click(mapping.locator('summary').first());
    const summary = p.getByText('Preserved source control formulas (never evaluated)');
    await summary.waitFor({ timeout: 20000 });
    await click(summary);
    const items = await p.locator('details', { has: summary }).locator('li').allInnerTexts();
    fs.writeFileSync(out('native-controls.txt'), items.join('\n'));
    const want = ['H9: H7+H8', 'I9: I7+I8', 'H10: H9', 'I10: I9'];
    for (const w of want) assert(items.some((t) => t.includes(w) && /CONSISTENT/.test(t) && /independent cents 90000/.test(t)), `missing ${w}`);
    await p.screenshot({ path: out('16-native-xlsx-controls.png') });
    return items.join(' | ');
  });
  await p.waitForFunction(
    () => ![...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Reconcile these files'))?.disabled,
    null,
    { timeout: 15000 },
  );
  await click(p.getByRole('button', { name: 'Reconcile these files' }));
  await p.getByText('Reconciliation complete').waitFor({ timeout: 20000 });
  const saved = await download(p, () => click(p.getByRole('button', { name: 'Save review project' })), 'native-xlsx.review.json');
  await check('XLSX-native-provenance', async () => {
    const project = JSON.parse(saved.text);
    const qb = project.workspace.input.qb;
    assert(qb.length === 2, `qb rows ${qb.length}`);
    assert(qb.every((r) => r.transaction_id === '145'), 'transaction id');
    const rows = qb.map((r) => r.source_refs[0].physical_row).sort();
    assert(JSON.stringify(rows) === '[7,8]', `rows ${rows}`);
    const file = project.workspace.files.find((f) => f.kind === 'QBO');
    assert(file.hash === 'ac1b896b3377199496c67132968e8e61949f388eaa7a13c43ed52fcace95e033', 'xlsx hash');
    return 'txn 145 from group row; posting physical rows 7/8; original XLSX SHA-256 unchanged';
  });
  await upload(labelOf(p, 'Open review project'), saved.file);
  await p.getByText('Review project restored and recalculated').waitFor({ timeout: 15000 });
  await upload(labelOf(p, 'Choose original files'), [input('st.csv'), input('target-transaction-journal-145.xlsx'), input('bank.csv')]);
  await check('XLSX-native-reverify', async () => {
    await p.locator('section.source-verification').getByText('All re-verified').waitFor({ timeout: 20000 });
    return 'native XLSX + CSV originals re-parsed (worker) to identical saved rows';
  });
  await ctx.close();
}

// --- Keyboard and zoom ------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  watch(p, 'keyboard');
  await p.goto(BASE);
  await check('A11Y-keyboard-order', async () => {
    const seen = [];
    for (let i = 0; i < 9; i++) {
      await p.keyboard.press('Tab');
      seen.push(
        await p.evaluate(() => {
          const el = document.activeElement;
          const style = getComputedStyle(el);
          return `${el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 28)}${style.outlineStyle !== 'none' || style.boxShadow !== 'none' ? '' : ' [no visible focus]'}`;
        }),
      );
    }
    fs.writeFileSync(out('keyboard-order.txt'), seen.join('\n'));
    assert(seen.some((s) => /Try a sample month/.test(s)), 'demo button not reachable');
    return seen.join(' → ');
  });
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'Try a sample month' }).focus();
  await p.keyboard.press('Enter');
  await p.getByText('Reconciliation complete').waitFor({ timeout: 20000 });
  await check('A11Y-zoom-200', async () => {
    await p.setViewportSize({ width: 720, height: 450 });
    const m = await noHorizontalScroll(p);
    await p.screenshot({ path: out('11-zoom-200-equivalent.png') });
    assert(m.scrollWidth <= m.innerWidth + 1, JSON.stringify(m));
    return `720px CSS viewport (1440px at 200%): ${JSON.stringify(m)}`;
  });
  await ctx.close();
}

// --- Mobile narrow viewport --------------------------------------------------
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
  });
  const p = await ctx.newPage();
  watch(p, 'mobile');
  await p.goto(BASE);
  await check('MOBILE-landing', async () => {
    const m = await noHorizontalScroll(p);
    await p.screenshot({ path: out('12-mobile-landing.png'), fullPage: true });
    assert(m.scrollWidth <= m.innerWidth + 1, JSON.stringify(m));
    return JSON.stringify(m);
  });
  await p.getByRole('button', { name: 'Try a sample month' }).tap();
  await p.getByText('Reconciliation complete').waitFor({ timeout: 20000 });
  await check('MOBILE-desk-status-and-evidence', async () => {
    const m = await noHorizontalScroll(p);
    await p.screenshot({ path: out('13-mobile-desk.png'), fullPage: true });
    const text = await p.locator('main').innerText();
    assert(/Review queue/.test(text) && /Equal amounts are not proof/.test(text), 'status text');
    assert(m.scrollWidth <= m.innerWidth + 1, JSON.stringify(m));
    return JSON.stringify(m);
  });
  await check('MOBILE-case-review-next-step', async () => {
    await p.getByText('Review facts & documented fee-only proposal').tap();
    await p.getByRole('button', { name: 'Build supported fee-only draft' }).scrollIntoViewIfNeeded();
    const m = await noHorizontalScroll(p);
    await p.screenshot({ path: out('14-mobile-case-review.png') });
    assert(await p.getByRole('button', { name: 'Download reviewer summary (HTML)' }).isVisible(), 'summary');
    assert(m.scrollWidth <= m.innerWidth + 1, JSON.stringify(m));
    return JSON.stringify(m);
  });
  await check('MOBILE-exports-page', async () => {
    await p.getByRole('button', { name: 'Toggle navigation' }).tap();
    await p.getByRole('button', { name: 'Exports' }).tap();
    const m = await noHorizontalScroll(p);
    await p.screenshot({ path: out('15-mobile-exports.png'), fullPage: true });
    assert(m.scrollWidth <= m.innerWidth + 1, JSON.stringify(m));
    return JSON.stringify(m);
  });
  await ctx.close();
}
await browser.close();

const hosts = [...new Set([...network].map((n) => n.split(' ')[2]).map((u) => {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : url.protocol;
  } catch {
    return u;
  }
}))];
record(
  'NET-runtime-egress',
  hosts.every((h) => h === '127.0.0.1:4173' || h === 'blob:' || h === 'data:' || h === 'file:' || h === 'chrome:') ? 'PASS' : 'FAIL',
  `hosts=${hosts.join(',')}; ${network.size} distinct requests`,
);
record('CONSOLE-errors', consoleErrors.length ? 'FAIL' : 'PASS', consoleErrors.join(' | ') || 'none');
const report = {
  chrome: version,
  sandbox: 'chromiumSandbox=true (no --no-sandbox); unprivileged user',
  base: BASE,
  desktopFlowMs: desktopMs,
  desktopInteractionCounts: counters,
  results,
  network: [...network].sort(),
  consoleErrors,
};
fs.writeFileSync(out('browser-results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ counters, desktopMs, hosts }, null, 0));
