// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import App from '../../src/app';
import { reconcile } from '../../src/engine';
import { example } from '../engine/helpers';
import { runImport } from '../../src/workers/import-client';
import { runReconciliation, type WorkerResult } from '../../src/workers/client';
import type { ImportManifest } from '../../src/contracts/canonical';
import type { ParseResult } from '../../src/ingestion/types';
import type { ReconcileResult } from '../../src/contracts/engine';
vi.mock('../../src/workers/import-client', () => ({ runImport: vi.fn() }));
vi.mock('../../src/workers/client', () => ({ runReconciliation: vi.fn() }));
vi.mock('../../src/workers/xlsx-client', () => ({
  runXlsxInspect: vi.fn(),
  runXlsxImport: vi.fn(),
}));
const defer = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function result(gross: number): ReconcileResult {
  return {
    groups: reconcile(example()).groups,
    controls: {
      st_gross_cents: gross,
      st_refunds_cents: 0,
      st_corrections_cents: 0,
      qb_debits_cents: 0,
      qb_credits_cents: 0,
      bank_signed_cents: 0,
      accounts: [],
      atoms: [],
      conservation_ok: true,
      coverage_confirmed: false,
    },
    warnings: [],
    allocations: [],
    searches: [],
    rejected_candidates: [],
    versions: { engine: 'TEST', rules: 'TEST', calendar: 'TEST', mapping: [] },
  };
}
const originalDialogMethods = {
  showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal'),
  close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close'),
};
beforeEach(() => {
  // jsdom has no native dialog UI. These stubs only expose lifecycle controls;
  // focus trapping and actual modal behavior require a real browser.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function () {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function () {
      this.open = false;
    },
  });
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, text: async () => 'synthetic test fixture' })),
  );
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.mocked(runReconciliation).mockReset();
  vi.mocked(runImport)
    .mockReset()
    .mockImplementation(
      async (_text, kind, options) =>
        ({
          ok: true,
          rows: [],
          manifest: {
            company_id: options.companyId,
            source_system: kind === 'COMPONENT' ? 'RECEIPT' : kind,
            source_file_sha256: kind.padEnd(64, '0'),
            report_name: options.fileName ?? '',
            report_grain: 'TEST',
            period_start: options.periodStart,
            period_end: options.periodEnd,
            as_of_date: options.asOfDate,
            company_timezone: options.companyTimezone,
            basis: 'ACCRUAL',
            accounts: [],
            account_balances: [],
            header_row: 1,
            raw_row_count: 0,
            normalized_row_count: 0,
            excluded_summary_rows: [],
            opening_debit_balance_cents: null,
            closing_debit_balance_cents: null,
            coverage_confirmed: false,
            missing_required_fields: [],
          } as ImportManifest,
          issues: [],
          mapping: null,
          duplicate: false,
          controls: { signedCents: 0, debitCents: null, creditCents: null, excludedRows: [] },
        }) as ParseResult as never,
    );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const name of ['showModal', 'close'] as const) {
    const original = originalDialogMethods[name];
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
describe('Supplemental parsing cancellation race (jsdom only)', () => {
  it('does not let stale supplemental parsing abort a newer reconciliation', async () => {
    const staleParse = defer<Awaited<ReturnType<typeof runImport>>>();
    const newerRun = defer<WorkerResult>();
    let newSignal: AbortSignal | undefined;
    vi.mocked(runReconciliation)
      .mockResolvedValueOnce({ result: result(100), duration_ms: 1 })
      .mockImplementationOnce((_input, signal) => {
        newSignal = signal;
        return newerRun.promise;
      })
      .mockResolvedValue({ result: result(999), duration_ms: 1 });
    render(createElement(App));
    fireEvent.click(screen.getByRole('button', { name: 'Load demo' }));
    await screen.findByText('$1.00');
    const regularImport = vi.mocked(runImport).getMockImplementation()!;
    vi.mocked(runImport).mockImplementation(async (text, kind, options, signal) => {
      if (kind === 'PROCESSOR') return staleParse.promise as never;
      return regularImport(text, kind, options, signal);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add evidence' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add sample evidence & recalculate' }));
    await waitFor(() =>
      expect(vi.mocked(runImport).mock.calls.some((c) => c[1] === 'PROCESSOR')).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset sample month' }));
    await waitFor(() => expect(runReconciliation).toHaveBeenCalledTimes(2));
    expect(newSignal?.aborted).toBe(false);
    const processorOptions = vi.mocked(runImport).mock.calls.find((c) => c[1] === 'PROCESSOR')![2];
    const parsed = await regularImport('synthetic test fixture', 'PROCESSOR', processorOptions);
    await act(async () => {
      staleParse.resolve(parsed);
    });
    expect(runImport).toHaveBeenCalledTimes(7);
    // Safety expectation: work cancelled during parsing may not touch the current worker.
    expect(newSignal?.aborted).toBe(false);
    expect(runReconciliation).toHaveBeenCalledTimes(2);
    await act(async () => {
      newerRun.resolve({ result: result(200), duration_ms: 2 });
    });
    expect(await screen.findByText('$2.00')).toBeTruthy();
  });
});
