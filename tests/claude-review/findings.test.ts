// Independent review regressions (2026-10-22). Synthetic data only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { contentHash } from '../../src/engine/identities';
import {
  initializeReview,
  openProject,
  serializeProject,
  reviewForGroup,
} from '../../src/review/project';
import { proposalFromCase, type CaseFacts } from '../../src/review/case-adapter';
import { approveProposal } from '../../src/export/aje';
import { exportQboCsv } from '../../src/export/qbo';
import { reconcile } from '../../src/engine';
import { sessionWorkspace, feeGroup, documentedFacts, withFacts } from './fee-case-fixture';

function rehash(text: string, fn: (x: any) => void): string {
  const x = JSON.parse(text);
  fn(x);
  const { integrity: _ignored, ...payload } = x;
  x.integrity = contentHash(payload);
  return JSON.stringify(x);
}

describe('F-00 real parser + engine fee case (positive control)', () => {
  it('parses actual CSV bytes into one accepted case and exports only Dr fee / Cr clearing', async () => {
    const base = await sessionWorkspace();
    const w = withFacts(base, documentedFacts(base));
    const g = feeGroup(w);
    expect([g.gross_cents, g.bank_cents, g.fees_cents]).toEqual([1000000, 910000, 90000]);
    expect(g.accepted).toBe(true);
    const r = reviewForGroup(w.review!, g.id)!;
    const draft = await proposalFromCase(w, g, r, r.reviewedFacts as unknown as CaseFacts);
    const approved = await approveProposal(draft, 'Synthetic reviewer');
    const csv = await exportQboCsv(approved);
    const lines = csv.content.trim().split(/\r?\n/);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Merchant Processing Fees');
    expect(lines[1]).toContain(',900.00,');
    expect(lines[2]).toContain('ServiceTitan Clearing');
    expect(lines[2]).toMatch(/,900\.00$/);
    expect(csv.content).not.toContain('Collections Checking');
    expect(csv.fileName.startsWith('SYNTHETIC')).toBe(false);
  });
});

describe('F-01 reopened normalized rows are not re-bound to original source bytes', () => {
  it('blocks an accounting draft from a reopened project until originals are re-verified', async () => {
    const base = await sessionWorkspace();
    const reopened = openProject(serializeProject(withFacts(base, documentedFacts(base))));
    const g = feeGroup(reopened);
    const r = reviewForGroup(reopened.review!, g.id)!;
    await expect(
      proposalFromCase(reopened, g, r, r.reviewedFacts as unknown as CaseFacts),
    ).rejects.toThrow(/original source/i);
  });
  it('does not let a hand-edited project (isDemo=false, recomputed integrity) yield an importable journal', async () => {
    const forged = rehash(
      readFileSync(
        'evidence/handoff-workflow-20261022/fixtures/synthetic-current-case.review.json',
        'utf8',
      ),
      (x) => {
        x.workspace.isDemo = false;
      },
    );
    const w = openProject(forged);
    const g = w.result.groups.find((x) => x.st_ids.length)!;
    const r = reviewForGroup(w.review!, g.id)!;
    await expect(
      proposalFromCase(w, g, r, r.reviewedFacts as unknown as CaseFacts),
    ).rejects.toThrow(/original source/i);
  });
});

describe('F-06 desk evidence and fee-only draft must agree on the posted bank leg', () => {
  it('blocks the draft while the engine still lists the QuickBooks bank posting as missing', async () => {
    const base = await sessionWorkspace();
    delete base.input.config!.qb_bank_account_names;
    base.result = reconcile(structuredClone(base.input));
    base.review = initializeReview(base);
    const w = withFacts(base, documentedFacts(base));
    const g = feeGroup(w);
    expect(g.edges.find((e) => e.kind === 'QB_BANK_SETTLEMENT')?.state).toBe('CANDIDATE');
    expect(g.diagnoses.flatMap((d) => d.missing_evidence)).toContain('QB_ACTUAL_BANK_POSTING');
    const r = reviewForGroup(w.review!, g.id)!;
    await expect(
      proposalFromCase(w, g, r, r.reviewedFacts as unknown as CaseFacts),
    ).rejects.toThrow(/bank settlement link is candidate, not confirmed/);
  });
});
