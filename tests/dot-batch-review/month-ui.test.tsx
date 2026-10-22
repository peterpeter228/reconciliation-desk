// @vitest-environment jsdom
// Measured form interactions, not real-browser or human-time acceptance.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { useState } from 'react';
import { writeFileSync } from 'node:fs';
import { CaseReview } from '../../src/components/CaseReview';
import type { Workspace } from '../../src/components/workspace';
import type { CaseFacts } from '../../src/review/case-adapter';
import { reviewForGroup } from '../../src/review/project';
import { monthFixture } from './fixture';
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('measures explicit month form edits: 180 individual vs 40 batch; identical 60 associations', async () => {
  const fixture = await monthFixture();
  fixture.current.reviewedFacts = { ...fixture.facts };
  let latest = fixture.w;
  function Harness({ initial }: { initial: Workspace }) {
    const [w, setW] = useState(initial);
    return (
      <CaseReview
        workspace={w}
        group={fixture.g}
        onChange={(next) => {
          latest = next;
          setW(next);
        }}
      />
    );
  }
  render(<Harness initial={structuredClone(fixture.w)} />);
  let individualOperations = 0;
  for (const batch of fixture.batches) {
    for (const id of batch.transactionIds) {
      for (const [label, value] of [
        [`Relation for ${id}`, 'OTHER_CASE'],
        [`Other case ID for ${id}`, batch.relatedCaseId],
        [`Association evidence for ${id}`, batch.evidenceHash],
      ]) {
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
        individualOperations++;
      }
    }
  }
  const individual = (
    reviewForGroup(latest.review!, fixture.g.id)!.reviewedFacts as unknown as CaseFacts
  ).relations;
  cleanup();
  render(<Harness initial={structuredClone(fixture.w)} />);
  let batchOperations = 0;
  for (const batch of fixture.batches) {
    for (const [label, value] of [
      ['Batch evidence', batch.evidenceHash],
      ['Batch other case', batch.relatedCaseId],
      ['Batch transaction IDs', batch.transactionIds.join('\n')],
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      batchOperations++;
    }
    fireEvent.click(screen.getByRole('button', { name: 'Apply reviewed OTHER_CASE list' }));
    batchOperations++;
  }
  const batched = (
    reviewForGroup(latest.review!, fixture.g.id)!.reviewedFacts as unknown as CaseFacts
  ).relations;
  expect(individual).toHaveLength(60);
  expect(batched).toEqual(individual);
  expect(latest.input).toEqual(fixture.w.input);
  expect(latest.review!.cases.map((c) => [c.exportHistory, c.existingImportStatus])).toEqual(
    fixture.w.review!.cases.map((c) => [c.exportHistory, c.existingImportStatus]),
  );
  expect(individualOperations).toBe(180);
  expect(batchOperations).toBe(40);
  expect(screen.queryByRole('button', { name: /select all/i })).toBeNull();
  const measurement = {
    syntheticOnly: true,
    measurement: 'jsdom form change/click events; not wall-clock time',
    cases: 10,
    transactionsPerCase: 6,
    explicitTransactions: 60,
    individualOperations,
    batchOperations,
    savedOperations: individualOperations - batchOperations,
    commonPreparationExcluded:
      'review documents/transaction IDs, attach evidence, reviewer, open panels; one textarea paste counts as one event',
    accountingPolicyUnchanged: true,
  };
  if (process.env.BATCH_MEASUREMENT_OUTPUT)
    writeFileSync(
      process.env.BATCH_MEASUREMENT_OUTPUT,
      JSON.stringify(measurement, null, 2) + '\n',
    );
  console.log(JSON.stringify(measurement));
});
