// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import App from '../../src/app';
import { sessionWorkspace } from '../claude-review/fee-case-fixture';
import type { Workspace } from '../../src/components/workspace';
import type { ImportPage } from '../../src/pages/import';
import { runReconciliation } from '../../src/workers/client';
let importer: Parameters<typeof ImportPage>[0];
let current: Workspace;
vi.mock('../../src/pages/import', () => ({
  ImportPage: (props: typeof importer) => {
    importer = props;
    return null;
  },
}));
vi.mock('../../src/pages/desk', () => ({
  EmptyDesk: () => null,
  DeskPage: ({
    workspace,
    onWorkspaceChange,
  }: {
    workspace: Workspace;
    onWorkspaceChange: (w: Workspace) => void;
  }) => {
    current = workspace;
    return (
      <button onClick={() => onWorkspaceChange({ ...workspace, runId: 'review-edited' })}>
        Edit review
      </button>
    );
  },
}));
vi.mock('../../src/workers/client', () => ({ runReconciliation: vi.fn() }));
vi.mock('../../src/workers/import-client', () => ({ runImport: vi.fn() }));
vi.mock('../../src/workers/xlsx-client', () => ({
  runXlsxImport: vi.fn(),
  runXlsxInspect: vi.fn(),
}));
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function dirtyWorkspace() {
  const w = await sessionWorkspace();
  vi.mocked(runReconciliation).mockReset().mockResolvedValue({ result: w.result, duration_ms: 1 });
  render(<App />);
  await act(async () => {
    await importer.onRun(w.input, w.files, w.options);
  });
  fireEvent.click(screen.getByText('Edit review'));
  return w;
}
it('F02/F07 keeps import promise pending until cancel and preserves editable workspace', async () => {
  const w = await dirtyWorkspace();
  let finished = false;
  let pending!: Promise<void>;
  await act(async () => {
    pending = importer.onRun(w.input, w.files, w.options).then(() => {
      finished = true;
    });
  });
  expect(screen.getByText('Replace this workspace?')).toBeTruthy();
  expect(finished).toBe(false);
  expect(runReconciliation).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.click(screen.getByText('Keep workspace'));
    await pending;
  });
  expect(finished).toBe(true);
  expect(current.runId).toBe('review-edited');
  expect(screen.getByText('Unsaved review changes')).toBeTruthy();
  fireEvent.click(screen.getByText('Edit review'));
  expect(current.runId).toBe('review-edited');
});
it('F02/F07 confirms replacement but resolves only after the worker finishes', async () => {
  const w = await dirtyWorkspace();
  let done!: (value: { result: typeof w.result; duration_ms: number }) => void;
  vi.mocked(runReconciliation).mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  let finished = false;
  await act(async () => {
    void importer.onRun(w.input, w.files, w.options).then(() => {
      finished = true;
    });
  });
  expect(finished).toBe(false);
  await act(async () => {
    fireEvent.click(screen.getByText('Replace workspace'));
  });
  expect(finished).toBe(false);
  await act(async () => {
    done({ result: w.result, duration_ms: 1 });
  });
  expect(finished).toBe(true);
});
it.each(['Close dialog', 'escape', 'backdrop'])(
  'F02 cancellation by %s settles without replacement',
  async (method) => {
    const w = await dirtyWorkspace();
    let finished = false;
    await act(async () => {
      void importer.onRun(w.input, w.files, w.options).then(() => {
        finished = true;
      });
    });
    await act(async () => {
      if (method === 'Close dialog') fireEvent.click(screen.getByLabelText(method));
      else if (method === 'escape')
        fireEvent(
          screen.getByRole('dialog'),
          new Event('cancel', { bubbles: true, cancelable: true }),
        );
      else fireEvent.click(screen.getByRole('dialog'));
    });
    expect(finished).toBe(true);
    expect(current.runId).toBe('review-edited');
    expect(runReconciliation).toHaveBeenCalledTimes(1);
  },
);
it('F07 unsaved edit installs unload protection and cancel keeps it', async () => {
  const w = await dirtyWorkspace();
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await act(async () => {
    void importer.onRun(w.input, w.files, w.options);
  });
  fireEvent.click(screen.getByText('Keep workspace'));
  const again = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(again);
  expect(again.defaultPrevented).toBe(true);
});
it('F02 superseding a pending replacement settles the first caller without running it', async () => {
  const w = await dirtyWorkspace();
  let firstDone = false;
  let secondDone = false;
  await act(async () => {
    void importer.onRun(w.input, w.files, w.options).then(() => {
      firstDone = true;
    });
    void importer.onRun(w.input, w.files, w.options).then(() => {
      secondDone = true;
    });
  });
  expect(firstDone).toBe(true);
  expect(secondDone).toBe(false);
  expect(runReconciliation).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.click(screen.getByText('Keep workspace'));
  });
  expect(secondDone).toBe(true);
  expect(current.runId).toBe('review-edited');
});
