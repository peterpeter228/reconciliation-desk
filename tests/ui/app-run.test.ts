// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import App from '../../src/app';
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
    groups: [],
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
beforeEach(() => {
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
});
describe('Local run cancellation and supersession (jsdom, not browser worker proof)', () => {
  it('does not install a cancelled reconciliation result', async () => {
    const gate = defer<WorkerResult>();
    vi.mocked(runReconciliation).mockReturnValueOnce(gate.promise);
    render(createElement(App));
    fireEvent.click(screen.getByRole('button', { name: 'Load demo' }));
    await waitFor(() => expect(runReconciliation).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => {
      gate.resolve({ result: result(100), duration_ms: 1 });
    });
    expect(screen.getByText('Run cancelled. Existing results were not changed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try a sample month' })).toBeTruthy();
    expect(
      screen.queryByText('Reconciliation complete. Review evidence before any accounting action.'),
    ).toBeNull();
  });
  it('keeps a newer completed run when the older cancelled worker resolves later', async () => {
    const older = defer<WorkerResult>(),
      newer = defer<WorkerResult>();
    vi.mocked(runReconciliation)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    render(createElement(App));
    fireEvent.click(screen.getByRole('button', { name: 'Load demo' }));
    await waitFor(() => expect(runReconciliation).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load demo' }));
    await waitFor(() => expect(runReconciliation).toHaveBeenCalledTimes(2));
    await act(async () => {
      newer.resolve({ result: result(200), duration_ms: 2 });
    });
    expect(screen.getByText('$2.00')).toBeTruthy();
    await act(async () => {
      older.resolve({ result: result(100), duration_ms: 1 });
    });
    expect(screen.getByText('$2.00')).toBeTruthy();
    expect(screen.queryByText('$1.00')).toBeNull();
  });
});
