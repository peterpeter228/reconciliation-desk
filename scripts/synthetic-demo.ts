/** Local-only synthetic demonstration. No network, posting, or approval simulation. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reconcile } from '../src/engine';
import { parseSource } from '../src/ingestion';
import type { EngineGroup } from '../src/contracts/engine';
import { loadFixture } from '../tests/integration/fixtures';
import {
  sessionWorkspace,
  feeGroup,
  sessionOptions,
} from '../tests/claude-review/fee-case-fixture';

const describeGroup = (g: EngineGroup) => ({
  groupId: g.id,
  grossCents: g.gross_cents,
  bankCents: g.bank_cents,
  feeCents: g.fees_cents,
  unexplainedCents: g.unexplained_cents,
  matchingState: g.matching_state,
  edges: g.edges?.map(({ kind, state, missing_evidence }) => ({ kind, state, missing_evidence })),
  feeDraftEligible: g.fee_aje_draft_eligible,
  searchStatus: g.search_status,
});

export async function buildSyntheticDemo() {
  const fixture = await loadFixture('samples');
  const baseline = reconcile(fixture.baseline);
  const enhanced = reconcile(fixture.enhanced);
  const clean = enhanced.groups.find(
    (g) =>
      g.gross_cents > 0 &&
      g.gross_cents === g.bank_cents &&
      g.fees_cents === 0 &&
      g.unexplained_cents === 0,
  );
  const ambiguous = baseline.groups.find((g) => g.matching_state === 'AMBIGUOUS');
  assert(clean, 'Expected a mathematically balanced synthetic case');
  assert(ambiguous, 'Expected an ambiguous synthetic case');
  const fee = feeGroup(await sessionWorkspace('clearing'));
  const uf = feeGroup(await sessionWorkspace('uf'));
  assert(fee.edges?.every((edge) => edge.state === 'CONFIRMED'));
  assert.equal(fee.fees_cents, 90000);
  assert.equal(fee.fee_aje_draft_eligible, false, 'Evidence is not human approval');
  assert.notEqual(uf.edges?.find((edge) => edge.kind === 'QB_BANK_SETTLEMENT')?.state, 'CONFIRMED');
  const original = await readFile('tests/fixtures/fee-case-csv/st_payments.csv', 'utf8');
  const invalid = await parseSource(original.replace('10000.00', 'INVALID_AMOUNT'), 'ST', {
    ...sessionOptions,
    fileName: 'SYNTHETIC_DO_NOT_IMPORT_invalid_amount.csv',
  });
  assert.equal(invalid.ok, false, 'Malformed monetary input must be blocked');
  return {
    schemaVersion: 1,
    classification: 'SYNTHETIC / DO NOT IMPORT',
    purpose:
      'Local technical demonstration only; no customer, market, or accounting-system acceptance claim',
    externalCalls: 0,
    accountingWrites: 0,
    scenarios: [
      {
        id: 'clean-arithmetic',
        explanation: '金额平衡不等于三条身份边全部确认；保留缺证据状态。',
        ...describeGroup(clean),
      },
      {
        id: 'documented-fee',
        explanation: '合成收款10000、银行9100、手续费900。三边确认仍需独立人工复核，未自动批准。',
        ...describeGroup(fee),
      },
      {
        id: 'undeposited-funds',
        explanation: 'UF 尚缺账簿银行腿，应走存款工作底稿，不冒充手续费入账许可。',
        ...describeGroup(uf),
      },
      {
        id: 'ambiguous',
        explanation: '存在多种候选，不按金额相同强行认定；不产生会计写入。',
        ...describeGroup(ambiguous),
      },
      {
        id: 'invalid-input-blocked',
        explanation: '将合成金额改成非法文本，真实解析器拒绝。原文件未修改。',
        importAllowed: invalid.ok,
        issues: invalid.issues.map(({ code, severity }) => ({ code, severity })),
      },
    ],
    limitations: [
      'CLI assertions are not browser acceptance',
      'Synthetic helper modules are reused from tests; no customer data',
      'No automatic approval, real QBO import, deployment, or demonstrated willingness to pay',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const i = process.argv.indexOf('--out');
  if (i >= 0 && !process.argv[i + 1]) throw new Error('--out requires a new output filename');
  const summary = JSON.stringify(await buildSyntheticDemo(), null, 2) + '\n';
  if (i >= 0) await writeFile(resolve(process.argv[i + 1]), summary, { flag: 'wx' });
  else process.stdout.write(summary);
}
