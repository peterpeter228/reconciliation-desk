// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CaseReview } from '../../src/components/CaseReview';
import App from '../../src/app';
import {
  sessionWorkspace,
  feeGroup,
  documentedFacts,
  withFacts,
} from '../claude-review/fee-case-fixture';
import { reviewForGroup } from '../../src/review/project';
vi.mock('../../src/workers/client', () => ({ runReconciliation: vi.fn() }));
vi.mock('../../src/workers/import-client', () => ({ runImport: vi.fn() }));
vi.mock('../../src/workers/xlsx-client', () => ({
  runXlsxImport: vi.fn(),
  runXlsxInspect: vi.fn(),
}));
afterEach(cleanup);
it('F03 prior export shows journal search and fresh GL review before any correction', async () => {
  const w = await sessionWorkspace();
  const g = feeGroup(w);
  reviewForGroup(w.review!, g.id)!.exportHistory.push({
    journalId: 'RD-SYNTHETIC-PRIOR',
    proposalId: 'p',
    proposalHash: 'a'.repeat(64),
    exportedAt: '2026-10-22T00:00:00.000Z',
    format: 'csv',
    status: 'UNKNOWN',
  });
  render(<CaseReview workspace={w} group={g} onChange={() => {}} />);
  expect(screen.getByText(/search for journal number/)).toBeTruthy();
  expect(screen.getByText(/re-export the GL or Transaction Journal/)).toBeTruthy();
  expect(screen.getByText(/failed download is not proof it was never imported/)).toBeTruthy();
});
it('F09 provides human-readable summary rather than only machine workpaper', async () => {
  const base = await sessionWorkspace();
  const w = withFacts(base, documentedFacts(base));
  render(<CaseReview workspace={w} group={feeGroup(w)} onChange={() => {}} />);
  expect(screen.getByRole('button', { name: 'Download reviewer summary (HTML)' })).toBeTruthy();
});
it('F08 privacy states company-label and missing-lock limitations without absolute guarantee', () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  render(<App />);
  fireEvent.click(screen.getByText('Privacy & limits'));
  const text = screen.getByRole('dialog').textContent!;
  expect(text).toMatch(/Company-label changes.*spelling or case/);
  expect(text).toMatch(/Without Web Locks/);
  expect(text).toMatch(/lost if site data is cleared/);
  expect(text).not.toContain('It blocks a second journal');
});
