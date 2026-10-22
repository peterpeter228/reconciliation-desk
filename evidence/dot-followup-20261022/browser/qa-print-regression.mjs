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

const ctx=await browser.newContext();const p=await ctx.newPage();watch(p,'print-regression');await p.goto(BASE);await click(p.getByRole('button',{name:'Try a sample month'}));await p.getByText('Reconciliation complete').waitFor();await click(p.getByRole('button',{name:'Exports',exact:true}));await click(p.getByRole('button',{name:/Evidence summary/}));await p.locator('.print-summary').waitFor({state:'attached'});await p.emulateMedia({media:'print'});const printStyle=await p.locator('.skip-link').evaluate(el=>({display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility,position:getComputedStyle(el).position}));fs.writeFileSync(out('computed-style.json'),JSON.stringify(printStyle,null,2));await check('PRINT-navigation-hidden',async()=>{assert(await p.locator('.skip-link').isHidden(),'Skip to workspace is visible under print media and overlays PDF rows');return 'Skip navigation is hidden in print';});await p.pdf({path:out('evidence-summary.pdf'),format:'A4',printBackground:true});await p.screenshot({path:out('print-media.png')});fs.writeFileSync(out('print-results.json'),JSON.stringify({results,consoleErrors},null,2));await browser.close();