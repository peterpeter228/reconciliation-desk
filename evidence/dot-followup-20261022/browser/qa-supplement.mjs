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

async function importedPage(ctx,qb,mode='JE_TO_CLEARING',keyboard=false){
 const p=await ctx.newPage(); watch(p,keyboard?'keyboard-import':qb);await p.goto(BASE);
 async function focus(loc){for(let n=0;n<100;n++){if(await loc.evaluate(el=>el===document.activeElement))return;await p.keyboard.press('Tab');}throw Error('Control not reachable in 100 Tabs');}
 const act=async loc=>{if(keyboard){await focus(loc);await p.keyboard.press('Enter');}else await click(loc);};
 const val=async(loc,v)=>{if(keyboard){await focus(loc);await p.keyboard.press('Control+A');await p.keyboard.type(v);}else await fill(loc,v);};
 const pick=async(loc,v)=>{if(keyboard){await focus(loc);await p.keyboard.press('Home');for(let n=0;n<15;n++){if(await loc.inputValue()===v)return;await p.keyboard.press('ArrowDown');}throw Error('Keyboard select option unavailable');}else await select(loc,v);};
 await act(p.getByRole('button',{name:'Use my files'}));
 for(const [title,file]of [['ServiceTitan','st_payments.csv'],['QuickBooks',qb],['Bank','bank_activity.csv']]){
  if(keyboard){console.log('KEYBOARD file',title);await focus(card(p,title));console.log('FOCUS',await p.locator(':focus').innerText());await p.screenshot({path:out('keyboard-before-'+title+'.png')});const[fc]=await Promise.all([p.waitForEvent('filechooser'),p.keyboard.press('Enter')]);await fc.setFiles(input(file));}else await upload(card(p,title),input(file));
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

const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
await check('EXTRA-keyboard-complete-import',async()=>{const p=await importedPage(ctx,'qbo_general_ledger.csv','JE_TO_CLEARING',true);await p.screenshot({path:out('keyboard-complete-import.png')});return 'Complete keyboard import with native FileChooser.setFiles';});
await check('EXTRA-print-main-app-PDF',async()=>{const p=await ctx.newPage();watch(p,'print');await p.goto(BASE);await click(p.getByRole('button',{name:'Try a sample month'}));await p.getByText('Reconciliation complete').waitFor();await click(p.getByRole('button',{name:'Exports',exact:true}));await click(p.getByRole('button',{name:/Evidence summary/}));await p.locator('.print-summary').waitFor({state:'attached'});await p.pdf({path:out('evidence-summary.pdf'),format:'A4',printBackground:true});return 'Visible app print control and Chromium PDF renderer';});
fs.writeFileSync(out('supplement-results.json'),JSON.stringify({results,network:[...network],consoleErrors},null,2));await browser.close();
