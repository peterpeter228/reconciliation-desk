/** Independent, reproducible Node-only performance and safety measurement.
 * Run: node --import tsx scripts/benchmark-3000.ts
 * Synthetic canonical JSONL fixtures are generated in memory with unique source
 * identities, actual source-content hashes and original 1-based row locators.
 * Parsing, fixture construction, assertions and JSON writing are outside timing.
 */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { cpus, platform, arch, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { reconcile, sha256, stableJSON } from '../src/engine';
import type {
  Bank_Deposit_Row,
  ImportManifest,
  Provenance,
  QB_Ledger_Entry,
  ST_Payment_Record,
} from '../src/contracts/canonical';
import type { ReconcileInput, ReconcileResult } from '../src/contracts/engine';

const OUTPUT = 'evidence/implementation-20261021/benchmark-3000.json';
const COMPANY = 'benchmark-synthetic-company';
const BANK = 'benchmark-collections';
const CLEARING = 'benchmark-clearing';
const NORMAL_SEED = 964103;
const MIXED_SEED = 204701;
const WARMUPS = 3;
const RUNS = 20;
const TARGET_MS = 500;

type Scenario = {
  name: string;
  seed: number;
  description: string;
  input: ReconcileInput;
  expectedVerifiedGroups: number;
  expectedUncertainPaymentIds: Set<string>;
  normalPaymentIds: Set<string>;
  sourceFiles: { source: string; name: string; sha256: string; rows: number; bytes: number }[];
};
const sum = (values: number[]) =>
  values.reduce((total, value) => {
    const next = total + value;
    assert(Number.isSafeInteger(next));
    return next;
  }, 0);
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}
function base(id: string) {
  return {
    id,
    company_id: COMPANY,
    currency: 'USD' as const,
    source_refs: [] as Provenance[],
    validation_errors: [] as string[],
  };
}
function payment(
  prefix: string,
  amount: number,
  payout: string | null,
  merchant: string,
): ST_Payment_Record {
  return {
    ...base(`${prefix}:st`),
    source_payment_id: `${prefix}:payment`,
    record_type: 'PAYMENT',
    row_grain: 'PAYMENT',
    original_payment_id: null,
    invoice_allocations: [],
    accounting_batch_id: `${prefix}:accounting-batch`,
    processor_batch_id: null,
    deposit_id: payout,
    payment_date: '2026-09-15',
    batch_close_date: '2026-09-15',
    batch_post_date: '2026-09-15',
    export_at: null,
    expected_settlement_date: null,
    export_status: 'EXPORTED',
    export_status_basis: 'SYSTEM',
    export_mode: 'JE_TO_CLEARING',
    customer_token: null,
    business_unit: null,
    payment_method: 'CHECK',
    card_brand: null,
    processor: null,
    merchant_id: merchant,
    bank_account_id: BANK,
    gross_cents: amount,
    reported_net_cents: null,
    reported_fee_cents: null,
    fee_mode: 'GROSS_SETTLED',
    reference: null,
    gl_account_code: null,
    payment_status: 'SUCCESS',
  };
}
function receipt(prefix: string, amount: number): QB_Ledger_Entry {
  return {
    ...base(`${prefix}:qb-receipt`),
    qb_product: 'QBO',
    transaction_id: `${prefix}:receipt-journal`,
    line_id: `${prefix}:receipt-line`,
    transaction_type: 'Journal Entry',
    posting_date: '2026-09-15',
    num: `${prefix}:accounting-batch`,
    name_token: null,
    memo_local: null,
    account_id: CLEARING,
    account_full_name: 'Synthetic Clearing',
    account_type: 'OTHER_CURRENT_ASSET',
    split_account: 'Accounts Receivable',
    debit_cents: amount,
    credit_cents: 0,
    signed_cents: amount,
    running_balance_cents: null,
    cleared_status: 'UNKNOWN',
    role: 'CLEARING_RECEIPT',
    line_grain: 'POSTING_LINE',
    linked_payment_id: `${prefix}:payment`,
    linked_deposit_id: null,
    accounting_batch_id: `${prefix}:accounting-batch`,
    is_posted_ledger: true,
    class_name: null,
    location_name: null,
  };
}
function bankRow(prefix: string, amount: number, payout: string | null): Bank_Deposit_Row {
  return {
    ...base(`${prefix}:bank`),
    bank_name: 'Synthetic benchmark bank',
    bank_account_id: BANK,
    source_transaction_id: `${prefix}:bank-source`,
    posted_date: '2026-09-16',
    value_date: null,
    pending: false,
    signed_cents: amount,
    description_local: 'Synthetic benchmark credit',
    descriptor_tokens: [],
    bank_type: 'CHECK_DEPOSIT',
    check_number: null,
    trace_id: null,
    deposit_id: payout,
    balance_cents: null,
    granularity: 'TRANSACTION',
  };
}
function bindSources(input: ReconcileInput, name: string): Scenario['sourceFiles'] {
  const files: Scenario['sourceFiles'] = [];
  const sources = [
    ['ST', input.st],
    ['QBO', input.qb],
    ['BANK', input.bank],
  ] as const;
  for (const [source, rows] of sources) {
    const fileName = `${name}.${source}.synthetic-canonical.jsonl`;
    const header = stableJSON({
      synthetic_only: true,
      schema: 'canonical-benchmark-v1',
      source,
      scenario: name,
    });
    const rawRows = rows.map((row) => {
      const { source_refs: _refs, ...raw } = row;
      return stableJSON(raw);
    });
    const bytes = `${header}\n${rawRows.join('\n')}\n`;
    const fileHash = sha256(bytes);
    rows.forEach((row, index) => {
      row.source_refs = [
        {
          file_sha256: fileHash,
          sheet: null,
          physical_row: index + 2,
          column_indices: { canonical_json_record: [0] },
          raw_row_sha256: sha256(rawRows[index]!),
          parser_version: 'synthetic-canonical-builder-1.0',
          mapping_version: 'canonical-explicit-1.0',
        },
      ];
    });
    const accounts = source === 'QBO' ? ['Synthetic Clearing', 'Synthetic Collections Bank'] : [];
    const accountBalances: ImportManifest['account_balances'] =
      source === 'QBO'
        ? accounts.map((account_full_name) => ({
            account_id: account_full_name === 'Synthetic Clearing' ? CLEARING : BANK,
            account_full_name,
            opening_debit_balance_cents: 0,
            closing_debit_balance_cents: sum(
              input.qb
                .filter((q) => q.account_full_name === account_full_name)
                .map((q) => q.signed_cents),
            ),
            coverage_confirmed: true,
          }))
        : [];
    input.manifests.push({
      company_id: COMPANY,
      source_system: source,
      source_file_sha256: fileHash,
      report_name: fileName,
      report_grain:
        source === 'ST' ? 'PAYMENT' : source === 'QBO' ? 'POSTING_LINE' : 'BANK_TRANSACTION',
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      as_of_date: '2026-09-30',
      company_timezone: 'America/New_York',
      basis: source === 'QBO' ? 'ACCRUAL' : 'NOT_APPLICABLE',
      accounts,
      account_balances: accountBalances,
      header_row: 1,
      raw_row_count: rows.length,
      normalized_row_count: rows.length,
      excluded_summary_rows: [],
      opening_debit_balance_cents: null,
      closing_debit_balance_cents: null,
      coverage_confirmed: true,
      missing_required_fields: [],
    });
    files.push({
      source,
      name: fileName,
      sha256: fileHash,
      rows: rows.length,
      bytes: Buffer.byteLength(bytes),
    });
  }
  return files;
}
function makeScenario(mixed: boolean): Scenario {
  const name = mixed
    ? 'identity-rich-with-ambiguous-and-capped-mixture'
    : 'identity-rich-complete-three-way';
  const seed = mixed ? MIXED_SEED : NORMAL_SEED;
  const next = generator(seed);
  const input: ReconcileInput = {
    st: [],
    qb: [],
    bank: [],
    manifests: [],
    config: {
      company_id: COMPANY,
      bank_account_id: BANK,
      period_cutoff: '2026-09-30',
      qb_bank_account_names: ['Synthetic Collections Bank'],
      calendar: { holidays: ['2026-09-07'], version: 'synthetic-september-2026' },
    },
  };
  const normalPaymentIds = new Set<string>();
  const expectedUncertainPaymentIds = new Set<string>();
  const normalCount = mixed ? 540 : 600;
  for (let i = 0; i < normalCount; i++) {
    const prefix = `${name}:normal:${i}`;
    const amount = 20_000 + (next() % 400_000);
    const payout = `${prefix}:deposit`;
    const st = payment(prefix, amount, payout, `${prefix}:merchant`);
    const qbReceipt = receipt(prefix, amount);
    const clearingSettlement: QB_Ledger_Entry = {
      ...qbReceipt,
      id: `${prefix}:qb-clearing-settlement`,
      transaction_id: `${prefix}:deposit-journal`,
      line_id: `${prefix}:clearing-credit`,
      posting_date: '2026-09-16',
      transaction_type: 'Deposit',
      num: payout,
      debit_cents: 0,
      credit_cents: amount,
      signed_cents: -amount,
      role: 'CLEARING_SETTLEMENT',
      linked_payment_id: null,
      linked_deposit_id: payout,
      accounting_batch_id: null,
      split_account: 'Synthetic Collections Bank',
    };
    const bankLeg: QB_Ledger_Entry = {
      ...clearingSettlement,
      id: `${prefix}:qb-bank-leg`,
      line_id: `${prefix}:bank-debit`,
      account_id: BANK,
      account_full_name: 'Synthetic Collections Bank',
      account_type: 'BANK',
      debit_cents: amount,
      credit_cents: 0,
      signed_cents: amount,
      role: 'BANK',
      split_account: 'Synthetic Clearing',
    };
    input.st.push(st);
    input.qb.push(qbReceipt, clearingSettlement, bankLeg);
    input.bank.push(bankRow(prefix, amount, payout));
    normalPaymentIds.add(st.id);
  }
  if (mixed) {
    // Ten same-amount receipts and ten deposits have no payout identity. Every
    // bank amount has multiple exact receipt choices, not one proved owner.
    for (let i = 0; i < 10; i++) {
      const prefix = `${name}:ambiguous:${i}`;
      const st = payment(prefix, 10_001, null, 'ambiguous-pool');
      input.st.push(st);
      input.qb.push(receipt(prefix, 10_001));
      input.bank.push(bankRow(prefix, 10_001, null));
      expectedUncertainPaymentIds.add(st.id);
    }
    // One hundred 100-cent components versus 70 500-cent bank targets exercise
    // the unchanged production 28-candidate cap. Arithmetic combinations exist,
    // but no amount/date-only claim may be certified or allocated.
    for (let i = 0; i < 100; i++) {
      const prefix = `${name}:capped-receipt:${i}`;
      const st = payment(prefix, 100, null, 'capped-pool');
      input.st.push(st);
      input.qb.push(receipt(prefix, 100));
      expectedUncertainPaymentIds.add(st.id);
    }
    for (let i = 0; i < 70; i++) input.bank.push(bankRow(`${name}:capped-bank:${i}`, 500, null));
  }
  const sourceFiles = bindSources(input, name);
  const all = [...input.st, ...input.qb, ...input.bank];
  assert.equal(all.length, 3_000, 'The benchmark must contain exactly 3,000 canonical core rows.');
  assert.equal(new Set(all.map((r) => r.id)).size, 3_000, 'Canonical IDs must be unique.');
  assert.equal(
    new Set(all.map((r) => `${r.source_refs[0]!.file_sha256}:${r.source_refs[0]!.physical_row}`))
      .size,
    3_000,
    'No two canonical rows reuse a physical source row.',
  );
  return {
    name,
    seed,
    input,
    normalPaymentIds,
    expectedUncertainPaymentIds,
    sourceFiles,
    expectedVerifiedGroups: normalCount,
    description: mixed
      ? '2,700 identity-rich rows (540 complete three-way cases), 30 rows forming ten equal-amount ambiguous receipts/deposits, and 270 rows forming 100 candidate-capped receipts plus 70 target deposits. No statement is provided for uncertain assignments.'
      : '600 independent complete three-way cases, each with one ST payment, receipt clearing debit, settlement clearing credit, actual posted QB bank debit, and bank transaction. Explicit synthetic full-period coverage and per-account balances.',
  };
}
function summarize(result: ReconcileResult) {
  const count = (values: string[]) =>
    Object.fromEntries(
      [...new Set(values)].sort().map((v) => [v, values.filter((x) => x === v).length]),
    );
  return {
    groups: result.groups.length,
    accepted_groups: result.groups.filter((g) => g.accepted).length,
    verified_three_way_groups: result.groups.filter(
      (g) => g.matching_scope === 'VERIFIED_THREE_WAY',
    ).length,
    group_states: count(result.groups.map((g) => g.matching_state)),
    searches: result.searches.length,
    unfinished_searches: result.searches.filter((s) => !s.complete).length,
    search_statuses: count(result.searches.map((s) => s.status)),
    allocations: result.allocations.length,
    source_atoms: result.controls.atoms.length,
    blocking_warnings: result.warnings.filter((w) => w.severity === 'BLOCKING').length,
    conservation_ok: result.controls.conservation_ok,
  };
}
function verify(scenario: Scenario, result: ReconcileResult): void {
  assert.equal(result.controls.atoms.length, 3_000);
  assert.equal(result.controls.conservation_ok, true);
  assert.equal(result.warnings.filter((w) => w.severity === 'BLOCKING').length, 0);
  assert.equal(result.controls.st_gross_cents, sum(scenario.input.st.map((s) => s.gross_cents)));
  assert.equal(result.controls.qb_debits_cents, sum(scenario.input.qb.map((q) => q.debit_cents)));
  assert.equal(result.controls.qb_credits_cents, sum(scenario.input.qb.map((q) => q.credit_cents)));
  assert.equal(
    result.controls.bank_signed_cents,
    sum(scenario.input.bank.map((b) => b.signed_cents)),
  );
  const byAtom = new Map<string, number>();
  for (const allocation of result.allocations)
    byAtom.set(
      allocation.atom_id,
      sum([byAtom.get(allocation.atom_id) ?? 0, allocation.signed_allocated_cents]),
    );
  for (const atom of result.controls.atoms) {
    assert.equal(atom.excluded_reason, null);
    assert.equal(atom.allocated_cents, byAtom.get(atom.atom_id) ?? 0);
    assert.equal(atom.allocated_cents + atom.residual_cents, atom.source_cents);
    assert(Math.abs(atom.allocated_cents) <= Math.abs(atom.source_cents));
    if (atom.allocated_cents !== 0)
      assert.equal(Math.sign(atom.allocated_cents), Math.sign(atom.source_cents));
  }
  const verified = result.groups.filter((g) => g.matching_scope === 'VERIFIED_THREE_WAY');
  assert.equal(
    verified.length,
    scenario.expectedVerifiedGroups,
    'No expected verified case may disappear and no uncertain case may become verified.',
  );
  assert.equal(result.groups.filter((g) => g.accepted).length, scenario.expectedVerifiedGroups);
  for (const group of verified) {
    assert.equal(group.matching_state, 'MATCHED');
    assert.equal(group.st_ids.length, 1);
    const stId = group.st_ids[0]!;
    assert(scenario.normalPaymentIds.has(stId));
    const prefix = stId.slice(0, -3);
    assert.deepEqual(
      group.bank_ids,
      [`${prefix}:bank`],
      'A proved bank must be the independently generated expected bank, not merely equal in amount.',
    );
    assert.deepEqual(
      [...group.qb_ids].sort(),
      [`${prefix}:qb-receipt`, `${prefix}:qb-clearing-settlement`, `${prefix}:qb-bank-leg`].sort(),
      'Verified groups must contain the exact independently generated posting lines.',
    );
    assert(group.edges.every((e) => e.state === 'CONFIRMED'));
    assert.equal(group.unexplained_cents, 0);
  }
  for (const group of result.groups) {
    assert.equal(group.fee_aje_draft_eligible, false);
    assert.equal(group.aje_state, 'INELIGIBLE');
    if (group.st_ids.some((id) => scenario.expectedUncertainPaymentIds.has(id))) {
      assert.equal(group.accepted, false);
      assert.notEqual(group.matching_state, 'MATCHED');
      assert.notEqual(group.matching_scope, 'VERIFIED_THREE_WAY');
    }
    assert.equal(
      group.diagnoses.some((d) => d.cause === 'PROCESSOR_HOLD' && d.evidence_level === 'CONFIRMED'),
      false,
    );
  }
  for (const id of scenario.expectedUncertainPaymentIds) assert.equal(byAtom.get(id) ?? 0, 0);
  if (scenario.expectedUncertainPaymentIds.size) {
    assert(result.groups.some((g) => g.matching_state === 'AMBIGUOUS'));
    assert(result.searches.some((s) => s.status === 'CANDIDATE_CAP' && !s.complete));
  }
}
async function sourceDigest() {
  const files: string[] = [];
  for (const directory of ['src/engine', 'src/contracts'])
    for (const item of (await readdir(directory)).sort())
      if (item.endsWith('.ts')) files.push(join(directory, item));
  return sha256(
    (await Promise.all(files.map(async (file) => `${file}\n${await readFile(file, 'utf8')}`))).join(
      '\n',
    ),
  );
}
const sourceBefore = await sourceDigest();
const results = [];
for (const scenario of [makeScenario(false), makeScenario(true)]) {
  const inputHash = sha256(stableJSON(scenario.input));
  const warmupDurations: number[] = [];
  const measured: { duration_ms: number; counts: ReturnType<typeof summarize> }[] = [];
  let versions: ReconcileResult['versions'] | undefined;
  for (let iteration = 0; iteration < WARMUPS + RUNS; iteration++) {
    const start = performance.now();
    const result = reconcile(scenario.input);
    const elapsed = performance.now() - start;
    verify(scenario, result); // correctness checks are mandatory but outside timing
    versions = result.versions;
    if (iteration < WARMUPS) warmupDurations.push(elapsed);
    else measured.push({ duration_ms: elapsed, counts: summarize(result) });
  }
  assert.equal(
    sha256(stableJSON(scenario.input)),
    inputHash,
    'The engine must not mutate its supplied source fixture.',
  );
  const sorted = measured.map((r) => r.duration_ms).sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1]!;
  results.push({
    name: scenario.name,
    seed: scenario.seed,
    fixture_description: scenario.description,
    canonical_rows: 3_000,
    rows_by_source: {
      ST: scenario.input.st.length,
      QB: scenario.input.qb.length,
      BANK: scenario.input.bank.length,
    },
    expected_verified_three_way_groups: scenario.expectedVerifiedGroups,
    uncertain_payment_atoms: scenario.expectedUncertainPaymentIds.size,
    input_sha256: inputHash,
    synthetic_source_files: scenario.sourceFiles,
    production_versions: versions,
    production_search_limits: {
      configured_overrides: null,
      max_candidates: 28,
      max_members: 8,
      max_nodes: 100_000,
      per_search_budget_ms: 80,
      total_search_budget_ms: 400,
    },
    warmup_runs: WARMUPS,
    warmup_durations_ms: warmupDurations,
    measured_runs: RUNS,
    percentile_method: 'nearest-rank over all 20 measured warm runs, no trimming',
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    min_ms: sorted[0],
    max_ms: sorted.at(-1),
    performance_target_ms: TARGET_MS,
    performance_target: 'warm p95 strictly below 500 ms for this disclosed Node scenario',
    performance_target_pass: percentile(0.95) < TARGET_MS,
    safety_assertions_passed_every_run: true,
    runs: measured,
  });
}
const sourceAfter = await sourceDigest();
assert.equal(
  sourceAfter,
  sourceBefore,
  'Production engine or contracts changed while benchmarking; rerun a stable snapshot.',
);
const output = {
  schema_version: '1.0',
  synthetic_only: true,
  measured_at_utc: new Date().toISOString(),
  execution: 'node --import tsx scripts/benchmark-3000.ts',
  scope:
    'Production TypeScript reconciliation engine in Node on exactly 3,000 canonical core rows per scenario. Excludes parser, Web Worker, browser, UI, disk output and test assertions. Not a real-customer, QBO/QBD-import or browser-performance claim.',
  fixture_generation:
    'Explicit deterministic synthetic canonical JSONL content; each source has an actual content SHA-256, each physical source row has a matching raw-row SHA-256, canonical row IDs and within-source stable row keys are unique; cross-source linkage identifiers are deliberately shared. Independent seeds are not supplied-demo answer keys.',
  source_snapshot_sha256: sourceBefore,
  runtime: {
    node: process.version,
    v8: process.versions.v8,
    platform: platform(),
    architecture: arch(),
    cpu_model: cpus()[0]?.model,
    logical_cpus: cpus().length,
    total_memory_bytes: totalmem(),
    max_rss_kib: process.resourceUsage().maxRSS,
    note: 'Shared execution host; no browser, CPU affinity or exclusive-host guarantee. Sequential scenarios; no forced GC or discarded outlier timings.',
  },
  results,
  all_safety_assertions_passed: true,
  all_measured_node_targets_passed: results.every((r) => r.performance_target_pass),
  limitations: [
    'Only these two disclosed canonical-input distributions are measured.',
    'Synthetic manifests explicitly assume complete coverage; this is not a claim about real books.',
    'Ambiguity and candidate caps must remain visible and unallocated; incomplete searches are not failed correctness checks.',
    'No parsing or end-to-end browser performance was measured.',
  ],
};
await mkdir('evidence/implementation-20261021', { recursive: true });
await writeFile(OUTPUT, JSON.stringify(output, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      output: OUTPUT,
      source_snapshot_sha256: sourceBefore,
      safety_assertions_passed: true,
      scenarios: results.map((r) => ({
        name: r.name,
        rows: r.canonical_rows,
        p50_ms: r.p50_ms,
        p95_ms: r.p95_ms,
        target_pass: r.performance_target_pass,
        unfinished_searches: [...new Set(r.runs.map((run) => run.counts.unfinished_searches))],
        search_statuses: r.runs[0]?.counts.search_statuses,
      })),
    },
    null,
    2,
  ),
);
if (!output.all_measured_node_targets_passed) process.exitCode = 1;
