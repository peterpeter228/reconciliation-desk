import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { openProject, serializeProject, reviewForGroup } from '../../src/review/project';
import { proposalFromCase, type CaseFacts } from '../../src/review/case-adapter';
import { approveProposal } from '../../src/export/aje';
import { exportQboCsv } from '../../src/export/qbo';
describe('actual engine to current-case accounting action', () => {
  it('recomputes accepted synthetic case, builds and exports exactly one two-line fee, restores export uncertainty', async () => {
    const w = openProject(
      readFileSync(
        'evidence/handoff-workflow-20261022/fixtures/synthetic-current-case.review.json',
        'utf8',
      ),
    );
    const g = w.result.groups.find((g) => g.st_ids.length)!;
    expect(g.accepted).toBe(true);
    expect(g.matching_state).toBe('MATCHED');
    const r = reviewForGroup(w.review!, g.id)!;
    const draft = await proposalFromCase(w, g, r, r.reviewedFacts as unknown as CaseFacts);
    const approved = await approveProposal(draft, 'Synthetic acceptance reviewer');
    const a = await exportQboCsv(approved);
    expect(a.content).toContain('900.00');
    expect(approved.lines).toHaveLength(2);
    expect(approved.lines.some((l) => l.account === 'Collections Checking')).toBe(false);
    r.proposal = approved;
    r.exportHistory.push({
      journalId: a.manifest.journalId,
      proposalId: a.manifest.proposalId,
      proposalHash: a.manifest.proposalHash,
      exportedAt: new Date().toISOString(),
      status: 'EXPORTED_NOT_POSTED',
      format: 'csv',
    });
    r.existingImportStatus = 'UNKNOWN';
    const reopened = openProject(serializeProject(w));
    const again = reviewForGroup(reopened.review!, g.id)!;
    expect(again.economicCaseId).toBe(r.economicCaseId);
    expect(again.exportHistory).toEqual(r.exportHistory);
    expect(again.proposal?.approval).toBeNull();
    await expect(
      proposalFromCase(reopened, g, again, again.reviewedFacts as unknown as CaseFacts),
    ).rejects.toThrow('prior');
  });
});
