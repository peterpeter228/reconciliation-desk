import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { parseSource, type ParseOptions } from '../src/ingestion';
import { reconcile } from '../src/engine';
const opts = JSON.parse(await readFile('examples/demo-profile.json', 'utf8')) as ParseOptions;
const st = await parseSource(await readFile('samples/st_export.csv', 'utf8'), 'ST', opts);
const qb = await parseSource(await readFile('samples/qbo_clearing_gl.csv', 'utf8'), 'QBO', opts);
const bank = await parseSource(await readFile('samples/chase_bank.csv', 'utf8'), 'BANK', opts);
if (!st.ok || !qb.ok || !bank.ok) throw new Error('Benchmark input import failed.');
const input = {
  st: st.rows,
  qb: qb.rows,
  bank: bank.rows,
  manifests: [st.manifest!, qb.manifest!, bank.manifest!],
  config: {
    company_id: opts.companyId,
    bank_account_id: opts.bankAccountId,
    period_cutoff: opts.periodEnd,
    clearing_split_semantics_confirmed: true,
  },
};
const values: number[] = [];
let incomplete = 0;
for (let i = 0; i < 21; i++) {
  const t = performance.now();
  const r = reconcile(input);
  const duration = performance.now() - t;
  if (i > 0) values.push(duration);
  incomplete = r.searches.filter((s) => !s.complete).length;
}
values.sort((a, b) => a - b);
const out = {
  scope:
    'Node TS production engine on supplied sample only. Not browser worker, not 3000-row acceptance, excludes parsing.',
  node: process.version,
  os: platform(),
  arch: arch(),
  cpu: cpus()[0]?.model,
  source_rows: st.rows.length + qb.rows.length + bank.rows.length,
  repetitions: values.length,
  warmup: 1,
  p50_ms: values[Math.ceil(values.length * 0.5) - 1],
  p95_ms: values[Math.ceil(values.length * 0.95) - 1],
  max_ms: values.at(-1),
  incomplete_searches: incomplete,
  timestamp: new Date().toISOString(),
};
await writeFile(
  'evidence/implementation-20261021/engine-benchmark.json',
  JSON.stringify(out, null, 2) + '\n',
);
console.log(JSON.stringify(out, null, 2));
