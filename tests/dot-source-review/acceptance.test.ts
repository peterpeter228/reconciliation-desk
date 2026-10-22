import { it, expect } from 'vitest';
import {
  sessionWorkspace,
  feeGroup,
  documentedFacts,
  withFacts,
} from '../claude-review/fee-case-fixture';
import {
  openProject,
  serializeProject,
  reviewForGroup,
  initializeReview,
} from '../../src/review/project';
import { proposalFromCase } from '../../src/review/case-adapter';
import { reconcile } from '../../src/engine';

it('F01 baseline: reopened normalized rows cannot draft without originals', async () => {
  const w = openProject(
    serializeProject(
      withFacts(await sessionWorkspace(), documentedFacts(await sessionWorkspace())),
    ),
  );
  // Isolate F01 from the separate F05 text-length defect on baseline.
  w.result.versions.mapping = ['test-mapping'];
  const g = feeGroup(w);
  await expect(
    proposalFromCase(w, g, reviewForGroup(w.review!, g.id)!, documentedFacts(w)),
  ).rejects.toThrow(/original source/);
});
it('F05 baseline: real parser multi-file versions permit a bounded draft', async () => {
  const w = await sessionWorkspace(),
    g = feeGroup(w);
  expect(w.result.versions.mapping.join('|').length).toBeGreaterThan(240);
  const p = await proposalFromCase(w, g, reviewForGroup(w.review!, g.id)!, documentedFacts(w));
  expect(p.feeCase.mappingVersion.length).toBeLessThanOrEqual(240);
});
it('F06 baseline: missing bank-account attribution cannot produce a draft', async () => {
  const w = await sessionWorkspace();
  delete w.input.config!.qb_bank_account_names;
  w.result = reconcile(structuredClone(w.input));
  w.review = initializeReview(w);
  w.result.versions.mapping = ['test-mapping'];
  const g = feeGroup(w);
  expect(g.edges.find((e) => e.kind === 'QB_BANK_SETTLEMENT')?.state).toBe('CANDIDATE');
  await expect(
    proposalFromCase(w, g, reviewForGroup(w.review!, g.id)!, documentedFacts(w)),
  ).rejects.toThrow(/bank settlement link/);
});
