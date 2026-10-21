// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { TeachingCase } from '../../src/pages/exports';
import { approvalMatchesView } from '../../src/components/approval';
import {
  approveProposal,
  buildFeeProposal,
  createTeachingFeeCase,
  type FeeProposal,
} from '../../src/export/aje';
import { exportQboCsv } from '../../src/export/qbo';
import { downloadText } from '../../src/components/workspace';
vi.mock('../../src/export/aje', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/export/aje')>();
  return {
    ...actual,
    buildFeeProposal: vi.fn(actual.buildFeeProposal),
    approveProposal: vi.fn(actual.approveProposal),
  };
});
vi.mock('../../src/export/qbo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/export/qbo')>();
  return { ...actual, exportQboCsv: vi.fn(actual.exportQboCsv) };
});
vi.mock('../../src/components/workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/components/workspace')>()),
  downloadText: vi.fn(),
}));
let actual: typeof import('../../src/export/aje');
let actualQbo: typeof import('../../src/export/qbo');
beforeAll(async () => {
  actual = await vi.importActual('../../src/export/aje');
  actualQbo = await vi.importActual('../../src/export/qbo');
});
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.mocked(buildFeeProposal).mockReset().mockImplementation(actual.buildFeeProposal);
  vi.mocked(approveProposal).mockReset().mockImplementation(actual.approveProposal);
  vi.mocked(exportQboCsv).mockReset().mockImplementation(actualQbo.exportQboCsv);
  vi.mocked(downloadText).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const defer = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const qboButton = () => screen.getByRole('button', { name: 'QBO CSV · Beta' }) as HTMLButtonElement;
async function ready() {
  render(createElement(TeachingCase));
  fireEvent.change(screen.getByLabelText('Reviewer name'), { target: { value: 'Alice Reviewer' } });
  await waitFor(() => expect(vi.mocked(buildFeeProposal).mock.results.length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Approve synthetic proposal' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}
async function approve() {
  fireEvent.click(screen.getByRole('button', { name: 'Approve synthetic proposal' }));
  await waitFor(() => expect(qboButton().disabled).toBe(false));
}
describe('Synthetic proposal review guards (jsdom, not browser fidelity)', () => {
  it('exports only after explicit approval and exact displayed snapshot', async () => {
    await ready();
    expect(qboButton().disabled).toBe(true);
    await approve();
    fireEvent.click(qboButton());
    await waitFor(() => expect(downloadText).toHaveBeenCalledTimes(2));
    expect(exportQboCsv).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Nothing was posted/)).toBeTruthy();
  });
  it('invalidates approval when the displayed journal date changes', async () => {
    await ready();
    await approve();
    fireEvent.change(screen.getByLabelText('Journal date'), { target: { value: '2026-09-29' } });
    await waitFor(() => expect(qboButton().disabled).toBe(true));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(downloadText).not.toHaveBeenCalled();
  });
  it('invalidates approval when the displayed reviewer changes', async () => {
    await ready();
    await approve();
    fireEvent.change(screen.getByLabelText('Reviewer name'), {
      target: { value: 'Different Reviewer' },
    });
    await waitFor(() => expect(qboButton().disabled).toBe(true));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });
  it('disables mutable controls while approval is pending and rejects a stale completion', async () => {
    await ready();
    const gate = defer<FeeProposal>();
    vi.mocked(approveProposal).mockReturnValueOnce(gate.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Approve synthetic proposal' }));
    expect((screen.getByLabelText('Journal date') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Reviewer name') as HTMLInputElement).disabled).toBe(true);
    const [draft, name] = vi.mocked(approveProposal).mock.calls.at(-1)!;
    // Simulate a programmatic change even though the rendered input is disabled.
    fireEvent.change(screen.getByLabelText('Journal date'), { target: { value: '2026-09-28' } });
    await act(async () => {
      gate.resolve(await actual.approveProposal(draft, name));
    });
    await waitFor(() => expect(qboButton().disabled).toBe(true));
    expect((screen.getByLabelText('Journal date') as HTMLInputElement).value).toBe('2026-09-28');
    expect(screen.queryByRole('button', { name: 'Approved for this example' })).toBeNull();
    expect(downloadText).not.toHaveBeenCalled();
  });
  it('keeps the newest draft when asynchronous rebuilds finish out of order', async () => {
    await ready();
    const older = defer<FeeProposal>(),
      newer = defer<FeeProposal>();
    vi.mocked(buildFeeProposal)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    fireEvent.change(screen.getByLabelText('Journal date'), { target: { value: '2026-09-29' } });
    fireEvent.change(screen.getByLabelText('Journal date'), { target: { value: '2026-09-28' } });
    await act(async () => {
      newer.resolve(
        await actual.buildFeeProposal({ ...createTeachingFeeCase(), journalDate: '2026-09-28' }),
      );
    });
    await act(async () => {
      older.resolve(
        await actual.buildFeeProposal({ ...createTeachingFeeCase(), journalDate: '2026-09-29' }),
      );
    });
    fireEvent.click(screen.getByRole('checkbox'));
    await approve();
    expect(vi.mocked(approveProposal).mock.calls.at(-1)![0].date).toBe('2026-09-28');
  });
  it('does not download after an export resolves following unmount', async () => {
    await ready();
    await approve();
    const gate = defer<Awaited<ReturnType<typeof exportQboCsv>>>();
    vi.mocked(exportQboCsv).mockReturnValueOnce(gate.promise);
    fireEvent.click(qboButton());
    const [approved] = vi.mocked(exportQboCsv).mock.calls.at(-1)!;
    cleanup();
    await act(async () => {
      gate.resolve(await actualQbo.exportQboCsv(approved));
    });
    expect(downloadText).not.toHaveBeenCalled();
  });
  it('pure visible-approval check rejects draft, changed date, and changed reviewer', async () => {
    const draft = await actual.buildFeeProposal(createTeachingFeeCase());
    const approved = await actual.approveProposal(draft, 'Alice');
    expect(approvalMatchesView(draft, draft.date, 'Alice')).toBe(false);
    expect(approvalMatchesView(approved, approved.date, 'Alice')).toBe(true);
    expect(approvalMatchesView(approved, '2026-09-29', 'Alice')).toBe(false);
    expect(approvalMatchesView(approved, approved.date, 'Bob')).toBe(false);
  });
});
