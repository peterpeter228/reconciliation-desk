import { expect, it } from 'vitest';
import { recordJournalCheck, type JournalCheck } from '../../src/review/unknown-recovery';
import { monthFixture } from './fixture';
import { proposalFromCase } from '../../src/review/case-adapter';
const glHash = 'a'.repeat(64);
const check: JournalCheck = {
  journalId: 'SYN-JOURNAL',
  reviewer: 'Synthetic reviewer',
  checkedAt: '2026-10-22T09:00:00Z',
  glReportHash: glHash,
  result: 'NOT_FOUND',
  scopeAndMethod:
    'Searched journal number in synthetic September accrual GL including all relevant accounts.',
};
async function scenario() {
  const state = await monthFixture(1, 2);
  state.current.existingImportStatus = 'UNKNOWN';
  state.current.exportHistory.push({
    journalId: check.journalId,
    proposalId: 'SYN-PROPOSAL',
    proposalHash: 'b'.repeat(64),
    exportedAt: '2026-10-21T09:00:00Z',
    status: 'EXPORTED_NOT_POSTED',
    format: 'csv',
  });
  return state;
}
it('appends found and not-found reviews, preserves exports and blocks both outcomes', async () => {
  const { w, g, current, facts } = await scenario();
  const before = structuredClone(current);
  const first = recordJournalCheck(current, undefined, check, [glHash]);
  const second = recordJournalCheck(
    current,
    first,
    { ...check, result: 'FOUND', checkedAt: '2026-10-22T10:00:00Z' },
    [glHash],
  );
  expect(second.history.map((c) => c.result)).toEqual(['NOT_FOUND', 'FOUND']);
  expect(first.history).toHaveLength(1);
  expect(second.accountingExportAllowed).toBe(false);
  expect(second.sameJournalRedownload).toBe('OWNER_POLICY_DECISION_REQUIRED');
  expect(current).toEqual(before);
  await expect(proposalFromCase(w, g, current, facts)).rejects.toThrow(
    /prior or uncertain import history/,
  );
});
it.each([
  'unknown-gl',
  'invalid-gl',
  'wrong-journal',
  'blank-reviewer',
  'wrong-history',
  'wrong-case',
])('rejects %s without touching prior history', async (variant) => {
  const { current } = await scenario();
  const prior = recordJournalCheck(current, undefined, check, [glHash]);
  const input = { ...check };
  if (variant === 'unknown-gl') input.glReportHash = 'c'.repeat(64);
  if (variant === 'invalid-gl') input.glReportHash = 'abc';
  if (variant === 'wrong-journal') input.journalId = 'different';
  if (variant === 'blank-reviewer') input.reviewer = ' ';
  if (variant === 'wrong-history')
    current.exportHistory.push({ ...current.exportHistory[0], journalId: 'new' });
  if (variant === 'wrong-case') current.economicCaseId = 'other';
  const before = structuredClone(prior);
  expect(() => recordJournalCheck(current, prior, input, [glHash])).toThrow();
  expect(prior).toEqual(before);
});
