// Synthetic-only counterfactual diagnostic. Does not modify production source or inputs.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { parseSource, parseXlsx } from '../../../src/ingestion/index.ts';
import { reconcile } from '../../../src/engine/index.ts';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (n: string) => readFileSync(root + n, 'utf8');
const profile = JSON.parse(
  read('evidence/browser-20261021-followup/import-profile-comparison.json'),
);
async function load(o: any, xlsx: boolean) {
  const st = xlsx
    ? await parseXlsx(
        new Uint8Array(
          readFileSync(new URL('../synthetic-upload-multisheet.xlsx', import.meta.url)),
        ),
        'ST',
        { ...o, sheetName: 'Payments', fileName: 'synthetic-multisheet.xlsx' },
      )
    : await parseSource(read('samples/st_export.csv'), 'ST', { ...o, fileName: 'st_export.csv' });
  const qb = await parseSource(read('samples/qbo_clearing_gl.csv'), 'QBO', {
    ...o,
    fileName: 'qbo_clearing_gl.csv',
  });
  const bank = await parseSource(read('samples/chase_bank.csv'), 'BANK', {
    ...o,
    fileName: 'chase_bank.csv',
  });
  if (![st, qb, bank].every((r) => r.ok))
    throw Error(JSON.stringify([st, qb, bank].map((r) => r.issues)));
  return {
    st: st.rows,
    qb: qb.rows,
    bank: bank.rows,
    manifests: [st.manifest!, qb.manifest!, bank.manifest!],
  };
}
const m = await load(profile.manual.options, true),
  mc = await load(profile.manual.options, false),
  d = await load(profile.demo.options, false),
  dx = await load(profile.demo.options, true);
const grouped = (v: any[]) =>
  Object.fromEntries([...new Set(v)].sort().map((x) => [x, v.filter((y) => x === y).length]));
function summary(input: any, config: any) {
  const r = reconcile({ ...input, config });
  return {
    groups: r.groups.length,
    acceptedGroups: r.groups.filter((g) => g.accepted).length,
    allocations: r.allocations.length,
    edgeStates: Object.fromEntries(
      ['ST_QB_RECEIPT', 'QB_BANK_SETTLEMENT', 'ST_BANK_CASH'].map((k) => [
        k,
        grouped(
          r.groups
            .flatMap((g) => g.edges)
            .filter((e) => e.kind === k)
            .map((e) => e.state),
        ),
      ]),
    ),
    controls: Object.fromEntries(
      Object.entries(r.controls).filter(([, v]) => typeof v !== 'object'),
    ),
    search: grouped(r.searches.map((s) => s.status)),
  };
}
const mconfig = profile.manual.config,
  dconfig = profile.demo.config;
const dconfigM = {
  ...dconfig,
  company_id: mconfig.company_id,
  bank_account_id: mconfig.bank_account_id,
};
const mconfigD = {
  ...mconfig,
  company_id: dconfig.company_id,
  bank_account_id: dconfig.bank_account_id,
};
const results: any = {
  scope:
    'Read-only synthetic diagnostic; no browser automation or source mutation. Each case changes only stated input/config.',
  cases: {
    manualXlsx: summary(m, mconfig),
    manualCsv: summary(mc, mconfig),
    demoCsv: summary(d, dconfig),
    demoXlsx: summary(dx, dconfig),
    manualDemoSplitConfig: summary(m, dconfigM),
    demoManualSplitConfig: summary(d, mconfigD),
  },
};
const cleaned = (r: any) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'source_refs'));
results.csvXlsxNormalizedRowsEqual = {
  manual: JSON.stringify(mc.st.map(cleaned)) === JSON.stringify(m.st.map(cleaned)),
  demo: JSON.stringify(d.st.map(cleaned)) === JSON.stringify(dx.st.map(cleaned)),
};
// Counterfactuals copy only the named normalized fields into an in-memory clone.
// They are not additional import acceptance runs, accounting evidence or approved mappings.
const variants = [
  ['qb_batch_ids', ['accounting_batch_id'], []],
  ['qb_bank_deposit_ids', ['linked_deposit_id'], ['deposit_id']],
  ['fee_roles', ['role'], []],
  [
    'all_inferred_ids_and_fee_roles',
    ['accounting_batch_id', 'linked_deposit_id', 'role'],
    ['deposit_id'],
  ],
] as const;
for (const [name, qfields, bfields] of variants) {
  const x = structuredClone(m);
  for (let i = 0; i < x.qb.length; i++)
    for (const f of qfields) (x.qb[i] as any)[f] = (d.qb[i] as any)[f];
  for (let i = 0; i < x.bank.length; i++)
    for (const f of bfields) (x.bank[i] as any)[f] = (d.bank[i] as any)[f];
  results.cases['manual_plus_' + name] = summary(x, mconfig);
  if (name === 'all_inferred_ids_and_fee_roles')
    results.cases.manual_plus_all_inferred_and_demo_config = summary(x, dconfigM);
}
const fieldDiffs = (a: any[], b: any[]) => {
  const counts: any = {};
  for (let i = 0; i < a.length; i++)
    for (const k of Object.keys(a[i]))
      if (JSON.stringify(a[i][k]) !== JSON.stringify(b[i][k])) counts[k] = (counts[k] ?? 0) + 1;
  return counts;
};
const md = await load(
  {
    ...profile.manual.options,
    companyId: profile.demo.options.companyId,
    bankAccountId: profile.demo.options.bankAccountId,
    bankName: 'Synthetic Chase-style',
  },
  false,
);
results.normalizedProfileDifferencesSameLabelsAndCsv = {
  st: fieldDiffs(d.st, md.st),
  qb: fieldDiffs(d.qb, md.qb),
  bank: fieldDiffs(d.bank, md.bank),
};
results.cases.manual_same_labels_as_demo = summary(md, { ...mconfigD });
assert.deepEqual([m.st.length, m.qb.length, m.bank.length], [359, 338, 140]);
assert.equal(
  m.manifests[0].source_file_sha256,
  '4e3ed6b1762accb6460dcda3e31e60944db6447a8cc049bd41b879630c9f3cc6',
);
assert.deepEqual(results.csvXlsxNormalizedRowsEqual, { manual: true, demo: true });
for (const name of [
  'manualXlsx',
  'manualCsv',
  'manualDemoSplitConfig',
  'manual_same_labels_as_demo',
]) {
  assert.equal(results.cases[name].groups, 416, name);
  assert.equal(results.cases[name].allocations, 0, name);
}
for (const name of ['demoCsv', 'demoXlsx', 'manual_plus_all_inferred_and_demo_config']) {
  assert.equal(results.cases[name].groups, 221, name);
  assert.equal(results.cases[name].allocations, 36, name);
  assert.equal(results.cases[name].acceptedGroups, 18, name);
}
for (const result of Object.values(results.cases) as any[]) {
  assert.equal(result.controls.conservation_ok, true);
  assert.deepEqual(result.controls, results.cases.manualXlsx.controls);
}
results.verification =
  'PASS: fixture hash, input row counts, CSV/XLSX parity, ablation counts and monetary controls asserted.';
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
