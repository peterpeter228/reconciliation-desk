// @vitest-environment jsdom
// Component lifecycle regression only, not real-browser acceptance.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { CaseReview } from '../../src/components/CaseReview';
import { openProject } from '../../src/review/project';
import * as adapter from '../../src/review/case-adapter';
import type { FeeProposal } from '../../src/export/aje';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('does not commit a pending draft after navigating away or clearing the workspace', async () => {
  const w = openProject(
    readFileSync(
      'evidence/handoff-workflow-20261022/fixtures/synthetic-current-case.review.json',
      'utf8',
    ),
  );
  const g = w.result.groups.find((g) => g.st_ids.length)!;
  let finish!: (p: FeeProposal) => void;
  const deferred = new Promise<FeeProposal>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(adapter, 'proposalFromCase').mockReturnValue(deferred);
  const onChange = vi.fn();
  const view = render(<CaseReview workspace={w} group={g} onChange={onChange} />);
  fireEvent.click(screen.getByText('Build supported fee-only draft'));
  expect(adapter.proposalFromCase).toHaveBeenCalledOnce();
  view.unmount();
  await act(async () => {
    finish({} as FeeProposal);
    await deferred;
  });
  expect(onChange).not.toHaveBeenCalled();
});
