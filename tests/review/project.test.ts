import { describe, expect, it, beforeAll } from 'vitest';
import { loadFixture, options } from '../integration/fixtures';
import { reconcile } from '../../src/engine';
import { contentHash } from '../../src/engine/identities';
import {
  initializeReview,
  openProject,
  serializeProject,
  reviewForGroup,
  updateReviewFacts,
} from '../../src/review/project';
import type { Workspace } from '../../src/components/workspace';
import { createTeachingFeeCase, buildFeeProposal, approveProposal } from '../../src/export/aje';
let base: Workspace;
beforeAll(async () => {
  const { baseline } = await loadFixture('samples');
  base = {
    input: baseline,
    result: reconcile(baseline),
    options,
    files: baseline.manifests.map((m) => ({
      name: m.report_name,
      kind: m.source_system,
      hash: m.source_file_sha256,
    })),
    duration: 1,
    isDemo: true,
    runId: 'review-test',
  };
  base.review = initializeReview(base);
});
function mutateEnvelope(text: string, fn: (x: any) => void) {
  const x = JSON.parse(text);
  fn(x);
  const { integrity, ...payload } = x;
  x.integrity = contentHash(payload);
  return JSON.stringify(x);
}
describe('durable local review projects', () => {
  it('returns concise invalid JSON and schema errors without exposing raw Zod output', () => {
    expect(() => openProject('{')).toThrow('Invalid review project JSON');
    expect(() => openProject('{"schemaVersion":999}')).toThrow('supported schema version 1');
  });
  it('roundtrips complete input and mapping with newly computed result', () => {
    const saved = serializeProject(base);
    const got = openProject(saved);
    expect(got.input).toEqual(base.input);
    expect(got.options).toEqual(base.options);
    expect(got.review?.cases.map((c) => c.economicCaseId)).toEqual(
      base.review?.cases.map((c) => c.economicCaseId),
    );
    expect(got.result.groups.length).toBe(base.result.groups.length);
  });
  it('does not trust a saved result or group status', () => {
    const changed = mutateEnvelope(serializeProject(base), (x) => {
      x.workspace.result = { groups: [{ id: 'fake', accepted: true }] };
    });
    expect(openProject(changed).result.groups.some((g) => g.id === 'fake')).toBe(false);
  });
  it('rejects bad schema, checksum and unavailable provenance even with recalculated envelope hash', () => {
    expect(() => openProject(serializeProject(base).replace('review-test', 'review-evil'))).toThrow(
      'integrity',
    );
    expect(() =>
      openProject(mutateEnvelope(serializeProject(base), (x) => (x.schemaVersion = 2))),
    ).toThrow();
    expect(() =>
      openProject(
        mutateEnvelope(
          serializeProject(base),
          (x) => (x.workspace.input.st[0].source_refs[0].file_sha256 = 'a'.repeat(64)),
        ),
      ),
    ).toThrow('unavailable');
  });
  it('preserves case/action and export history after engine group identifiers change', () => {
    const w = structuredClone(base);
    const old = w.review!.cases.find((c) => c.identityStatus === 'BOUND')!;
    old.exportHistory.push({
      journalId: 'RDPRIOR',
      proposalId: 'proposal',
      proposalHash: 'b'.repeat(64),
      exportedAt: '2026-10-22T00:00:00.000Z',
      status: 'EXPORTED_NOT_POSTED',
      format: 'csv',
    });
    old.existingImportStatus = 'UNKNOWN';
    w.result.groups = w.result.groups.map((g) => ({ ...g, id: g.id + '-new' }));
    const updated = initializeReview(w, w.review);
    const got = reviewForGroup(updated, old.engineGroupId + '-new')!;
    expect(got.economicCaseId).toBe(old.economicCaseId);
    expect(got.accountingActionId).toBe(old.accountingActionId);
    expect(got.exportHistory[0]?.journalId).toBe('RDPRIOR');
    expect(got.existingImportStatus).toBe('UNKNOWN');
  });
  it('invalidates old approval on changed input and always on reopening', async () => {
    const w = structuredClone(base);
    const c = w.review!.cases.find((c) => c.identityStatus === 'BOUND')!;
    const fee = createTeachingFeeCase();
    fee.caseId = c.economicCaseId;
    c.proposal = await approveProposal(
      await buildFeeProposal(fee),
      'reviewer',
      '2026-10-22T00:00:00.000Z',
    );
    const opened = openProject(serializeProject(w));
    expect(
      opened.review!.cases.find((x) => x.economicCaseId === c.economicCaseId)!.proposal?.approval,
    ).toBeNull();
    w.options.asOfDate = '2026-10-23';
    expect(
      initializeReview(w, w.review).cases.find((x) => x.economicCaseId === c.economicCaseId)!
        .proposal?.state,
    ).toBe('DRAFT');
  });
  it('keeps ambiguous old action as unknown rather than allowing duplicate import', () => {
    const w = structuredClone(base);
    const g = w.result.groups.find(
      (g) => w.review!.cases.find((c) => c.engineGroupId === g.id)?.identityStatus === 'BOUND',
    )!;
    const old = reviewForGroup(w.review!, g.id)!;
    old.exportHistory = [
      {
        journalId: 'RDOLD',
        proposalId: 'old',
        proposalHash: 'c'.repeat(64),
        exportedAt: '2026-10-22T00:00:00.000Z',
        status: 'EXPORTED_NOT_POSTED',
        format: 'csv',
      },
    ];
    w.result.groups = [
      { ...g, id: 'split-a' },
      { ...g, id: 'split-b' },
    ];
    const got = initializeReview(w, w.review);
    expect(got.cases.every((c) => c.existingImportStatus === 'UNKNOWN')).toBe(true);
    expect(got.orphanedCases.some((c) => c.economicCaseId === old.economicCaseId)).toBe(true);
  });
  it('revokes a proposal on review facts edits without losing exported journals', async () => {
    const w = structuredClone(base);
    const c = w.review!.cases[0]!;
    const fee = createTeachingFeeCase();
    fee.caseId = c.economicCaseId;
    c.proposal = await buildFeeProposal(fee);
    c.exportHistory = [
      {
        journalId: 'RDKEEP',
        proposalId: 'p',
        proposalHash: 'a'.repeat(64),
        exportedAt: '2026-10-22T00:00:00.000Z',
        status: 'EXPORTED_NOT_POSTED',
        format: 'csv',
      },
    ];
    const got = updateReviewFacts(w.review!, c.economicCaseId, { journalDate: '2026-10-22' })
      .cases[0]!;
    expect(got.proposal).toBeUndefined();
    expect(got.exportHistory[0]!.journalId).toBe('RDKEEP');
  });
  it('rejects malformed restored review arrays before UI access', () => {
    for (const key of ['documents', 'reviewedAccounts', 'relations', 'ufPayments'])
      expect(() =>
        openProject(
          mutateEnvelope(serializeProject(base), (x) => {
            x.workspace.review.cases[0].reviewedFacts[key] = { not: 'array' };
          }),
        ),
      ).toThrow();
  });
  it('rejects dangerous object keys and malformed JSON', () => {
    expect(() => openProject('{"__proto__":{}}')).toThrow('Unsafe');
    expect(() => openProject('{')).toThrow();
  });
});
