import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSource } from '../../src/ingestion';
import { reconcile } from '../../src/engine';
import type { QB_Ledger_Entry } from '../../src/contracts/canonical';
import { sessionOptions, sessionWorkspace } from '../claude-review/fee-case-fixture';

const root = 'evidence/dot-followup-20261022/native-gl/';
const options = {
  ...sessionOptions,
  ledgerReportScope: 'ACCOUNT_ACTIVITY' as const,
  accountMap: {
    ...sessionOptions.accountMap,
    'Collections Checking': { accountType: 'BANK' as const, role: 'BANK' as const },
    'Accounts Receivable': { accountType: 'OTHER' as const, role: 'OTHER' as const },
  },
};
async function run(name: string, omit?: string) {
  let text = readFileSync(root + name, 'utf8');
  if (omit) {
    // Fixture has no quoted commas; remove a whole identity column, not its semantics.
    const lines = text
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(','));
    const index = lines[0]!.indexOf(omit);
    expect(index).toBeGreaterThan(-1);
    text = lines.map((line) => line.filter((_, i) => i !== index).join(',')).join('\n');
  }
  const parsed = await parseSource(text, 'QBO', { ...options, fileName: name });
  expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
  const workspace = await sessionWorkspace();
  workspace.input.qb = parsed.rows as QB_Ledger_Entry[];
  workspace.input.manifests = workspace.input.manifests.filter((m) => m.source_system !== 'QBO');
  workspace.input.manifests.push(parsed.manifest!);
  const result = reconcile(workspace.input);
  return { parsed, result };
}

describe('H5 native-column synthetic GL, no amount-derived identity', () => {
  it('imports native-style columns but does not certify coincident amounts or Num as identity', async () => {
    const { parsed, result } = await run('native-style.csv');
    const rows = parsed.rows as QB_Ledger_Entry[];
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.role)).toEqual([
      'CLEARING_RECEIPT',
      'UNKNOWN',
      'BANK',
      'CLEARING_SETTLEMENT',
    ]);
    expect(
      rows.every((r) => !r.linked_payment_id && !r.linked_deposit_id && !r.transaction_id),
    ).toBe(true);
    expect(result.groups.some((g) => g.matching_scope === 'VERIFIED_THREE_WAY')).toBe(false);
  });
  it('three evidence-supplied columns yield the complete exact case without Role or Account Type columns', async () => {
    const { parsed, result } = await run('supplemented.csv');
    const group = result.groups.find((g) => g.st_ids.length && g.bank_ids.length)!;
    expect(group).toBeDefined();
    expect(group.edges.every((e) => e.state === 'CONFIRMED')).toBe(true);
    expect(group.matching_scope).toBe('VERIFIED_THREE_WAY');
    expect([group.gross_cents, group.bank_cents, group.fees_cents]).toEqual([
      1000000, 910000, 90000,
    ]);
    expect(parsed.mapping!.headers).not.toContain('Role');
    expect(parsed.mapping!.headers).not.toContain('Account Type');
  });
  for (const column of ['Linked Payment ID', 'Linked Deposit ID']) {
    it(`removing ${column} breaks the complete evidence chain`, async () => {
      const { result } = await run('supplemented.csv', column);
      expect(result.groups.some((g) => g.matching_scope === 'VERIFIED_THREE_WAY')).toBe(false);
    });
  }
  it('records actual parser and engine observations separately from human operation estimates', async () => {
    const measurements = [];
    for (const file of ['native-style.csv', 'supplemented.csv']) {
      const { parsed, result } = await run(file);
      measurements.push({
        file,
        sha256: parsed.manifest!.source_file_sha256,
        headers: parsed.mapping!.headers,
        rows: parsed.rows.length,
        issues: parsed.issues,
        groups: result.groups.map((g) => ({
          scope: g.matching_scope,
          accepted: g.accepted,
          edges: g.edges.map((e) => ({ kind: e.kind, state: e.state })),
          amounts: { gross: g.gross_cents, bank: g.bank_cents, fees: g.fees_cents },
        })),
      });
    }
    if (process.env.RECORD_NATIVE_GL === '1')
      writeFileSync(
        root + 'measurements.json',
        JSON.stringify(
          {
            synthetic_only: true,
            measured_at: new Date().toISOString(),
            method: 'production parseSource + reconcile; no browser/time/click measurement',
            measurements,
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx' },
      );
    expect(measurements).toHaveLength(2);
  });
});
