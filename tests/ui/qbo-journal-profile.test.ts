// @vitest-environment jsdom
// Real parsers through mocked worker transports. These are source UI tests, not browser proof.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { utils, write } from 'xlsx';
import { ImportPage } from '../../src/pages/import';
import { DeskPage } from '../../src/pages/desk';
import type { Workspace } from '../../src/components/workspace';
import { reconcile } from '../../src/engine';
import { runImport } from '../../src/workers/import-client';
import { runXlsxImport, runXlsxInspect } from '../../src/workers/xlsx-client';
import { inspectXlsx } from '../../src/ingestion/xlsx';
import { parseSource } from '../../src/ingestion/csv';
import type { ParseResult } from '../../src/ingestion/types';
vi.mock('../../src/workers/import-client', async () => {
  const { parseSource } = await import('../../src/ingestion/csv');
  return { runImport: vi.fn(parseSource) };
});
vi.mock('../../src/workers/xlsx-client', async () => {
  const { inspectXlsx, parseXlsx } = await import('../../src/ingestion/xlsx');
  return {
    runXlsxInspect: vi.fn(async (bytes, name) => inspectXlsx(bytes, name)),
    runXlsxImport: vi.fn(parseXlsx),
  };
});
const native = readFileSync(
  'evidence/quickbooks-acceptance-20261021/target-transaction-journal-145.csv',
  'utf8',
);
const company = "Craig's Design and Landscaping Services";
const st = 'Payment ID,Payment Date,Payment Amount\nQA,09/30/2026,900.00\n';
const bank =
  'Details,Posting Date,Description,Amount,Type\nCREDIT,09/30/2026,SYNTHETIC,900.00,DEPOSIT\n';
const qb =
  'Date,Transaction Type,Num,Account,Debit,Credit\n09/30/2026,Journal Entry,J1,ServiceTitan Clearing,900.00,\n';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.mocked(runImport).mockReset().mockImplementation(parseSource);
  vi.mocked(runXlsxImport).mockClear();
  vi.mocked(runXlsxInspect)
    .mockReset()
    .mockImplementation(async (bytes, name) => inspectXlsx(bytes, name));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup() {
  const onRun = vi.fn(async () => {});
  render(createElement(ImportPage, { onRun, busy: false, onDemo: vi.fn() }));
  return onRun;
}
function startUpload(label: string, name: string, bytes: Uint8Array<ArrayBuffer>) {
  const file = new File([bytes], name);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
}
async function upload(label: string, name: string, text: string) {
  startUpload(label, name, new TextEncoder().encode(text));
  await screen.findByRole('button', { name: new RegExp(name.replaceAll('.', '\\.')) });
}
function selectNative() {
  fireEvent.change(screen.getByLabelText('QuickBooks report profile'), {
    target: { value: 'qbo-transaction-journal-v1' },
  });
}
function scope() {
  fireEvent.change(screen.getByLabelText('Company label'), { target: { value: 'UI_SYNTHETIC' } });
  fireEvent.change(screen.getByLabelText('Bank account label'), {
    target: { value: 'Synthetic checking' },
  });
  fireEvent.change(screen.getByLabelText('Clearing account, exact GL name'), {
    target: { value: 'ServiceTitan Clearing' },
  });
  fireEvent.change(screen.getByLabelText('ServiceTitan export mode'), {
    target: { value: 'JE_TO_CLEARING' },
  });
}
async function files(qbText = native) {
  await upload('Choose ServiceTitan CSV', 'st.csv', st);
  await upload('Choose QuickBooks CSV', 'journal.csv', qbText);
  await upload('Choose Bank CSV', 'bank.csv', bank);
}
async function validate() {
  fireEvent.click(screen.getByLabelText(/I reviewed the mappings and source scope/));
  fireEvent.click(screen.getByRole('button', { name: 'Validate files' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Validate files' })).toBeTruthy(), {
    timeout: 5000,
  });
}
const enabled = () =>
  !(screen.getByRole('button', { name: 'Reconcile these files' }) as HTMLButtonElement).disabled;
describe('Explicit native QBO Transaction Journal selection', () => {
  it('keeps manual default, does not auto-select a native-looking report, and disallows the profile for QBD', async () => {
    setup();
    expect((screen.getByLabelText('QuickBooks report profile') as HTMLSelectElement).value).toBe(
      'manual',
    );
    await upload('Choose QuickBooks CSV', 'native.csv', native);
    expect(vi.mocked(runImport).mock.calls[0][2].profile).toBe('manual');
    expect(screen.queryByLabelText('Expected report company name')).toBeNull();
    selectNative();
    fireEvent.change(screen.getByLabelText('QuickBooks product'), { target: { value: 'QBD' } });
    expect(screen.queryByLabelText('QuickBooks report profile')).toBeNull();
    await upload('Choose QuickBooks CSV', 'qbd.csv', qb);
    const call = vi.mocked(runImport).mock.calls.at(-1)!;
    expect(call[1]).toBe('QBD');
    expect(call[2].profile).toBe('manual');
    fireEvent.change(screen.getByLabelText('QuickBooks product'), { target: { value: 'QBO' } });
    expect((screen.getByLabelText('QuickBooks report profile') as HTMLSelectElement).value).toBe(
      'manual',
    );
  });
  it('validates untouched native CSV with explicit company and posts only transaction-scoped evidence to onRun', async () => {
    const onRun = setup();
    selectNative();
    fireEvent.change(screen.getByLabelText('Expected report company name'), {
      target: { value: company },
    });
    scope();
    await files();
    await validate();
    expect(screen.getByText('Validation passed')).toBeTruthy();
    expect(enabled()).toBe(true);
    const call = vi
      .mocked(runImport)
      .mock.calls.find((c) => c[1] === 'QBO' && c[2].postedLedgerConfirmed)!;
    expect(call[2]).toMatchObject({
      profile: 'qbo-transaction-journal-v1',
      qboTransactionJournalCompanyName: company,
      coverageConfirmed: false,
      dateFormat: 'MDY',
    });
    expect(call[2].accountBalances).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile these files' }));
    expect(onRun).toHaveBeenCalledTimes(1);
    const input = onRun.mock.calls[0] as unknown as [
      import('../../src/contracts/engine').ReconcileInput,
      unknown,
      import('../../src/ingestion/types').ParseOptions,
    ];
    expect(input[0].qb).toHaveLength(2);
    expect(input[0].qb.every((r) => r.transaction_id === '145')).toBe(true);
    expect(input[0].manifests?.find((m) => m.source_system === 'QBO')?.coverage_confirmed).toBe(
      false,
    );
    expect(input[2].coverageConfirmed).toBe(false);
    fireEvent.change(screen.getByLabelText('Expected report company name'), {
      target: { value: 'Different company' },
    });
    expect(enabled()).toBe(false);
    expect(screen.queryByText('Validation passed')).toBeNull();
    expect(screen.getByText('REPORT_SETTINGS_CHANGED')).toBeTruthy();
    const card = document.querySelectorAll('.mapping-card')[1] as HTMLElement;
    expect((within(card).getByLabelText('Header row') as HTMLInputElement).value).toBe('5');
    await validate();
    expect(enabled()).toBe(false);
    expect(screen.getByText(/report company does not match/i)).toBeTruthy();
  });
  it('requires independently entered company name rather than reusing local company label', async () => {
    setup();
    selectNative();
    scope();
    await files();
    await validate();
    expect(screen.getByText(/Enter the independently reviewed company name/)).toBeTruthy();
    expect(enabled()).toBe(false);
    expect(
      vi.mocked(runImport).mock.calls.filter((c) => c[1] === 'QBO' && c[2].postedLedgerConfirmed),
    ).toHaveLength(0);
  });
  it('shows authoritative fixed bindings and distinguishes physical report rows from posting lines', async () => {
    setup();
    selectNative();
    scope();
    await files();
    // The first preview is blocked. Validation creates mappings after company input changes,
    // so these labels must come from the validated result rather than stale form bindings.
    fireEvent.change(screen.getByLabelText('Expected report company name'), {
      target: { value: company },
    });
    await validate();
    const card = document.querySelectorAll('.mapping-card')[1] as HTMLElement;
    const selects = Array.from(card.querySelectorAll('select'));
    expect(selects).toHaveLength(8); // Eight posting columns; column 1 belongs to group/control rows.
    expect(selects.map((select) => select.value)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(selects.every((select) => select.disabled)).toBe(true);
    expect(within(card).getByText(/Transaction IDs come from validated group rows/)).toBeTruthy();
    expect(within(card).getByText('6 nonempty records after header')).toBeTruthy();
    expect(within(card).getByText('2 normalized')).toBeTruthy();
    expect(within(card).getByText('11 non-posting rows (includes preamble/blanks)')).toBeTruthy();
    expect(within(card).queryByText(/summaries excluded/)).toBeNull();
    expect(within(card).getByText('Debit total: $900.00')).toBeTruthy();
    expect(within(card).getByText('Credit total: $900.00')).toBeTruthy();
    expect(within(card).getByText('Row 6: Validated transaction identity group')).toBeTruthy();
    expect(
      within(card).getByText(
        'Row 9: Transaction subtotal control; consistency recorded separately',
      ),
    ).toBeTruthy();
    expect(within(card).getByText('Row 10: Validated report grand total')).toBeTruthy();
    expect(within(card).getByText('Row 14: Validated native report timestamp footer')).toBeTruthy();
    expect(within(card).queryByText(/^Row [78]:/)).toBeNull();
  });
  it('keeps native report exclusion labels accurate in the Desk manifest without relabeling manual sources', async () => {
    const onRun = setup();
    selectNative();
    scope();
    fireEvent.change(screen.getByLabelText('Expected report company name'), {
      target: { value: company },
    });
    await files();
    await validate();
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile these files' }));
    const [input, sourceFiles, options] = onRun.mock.calls[0] as unknown as [
      Workspace['input'],
      Workspace['files'],
      Workspace['options'],
    ];
    cleanup();
    render(
      createElement(DeskPage, {
        workspace: {
          input,
          files: sourceFiles,
          options,
          result: reconcile(input),
          duration: 0,
          isDemo: false,
          runId: 'native-label-regression',
        },
        onAddEvidence: vi.fn(),
        onExportReview: vi.fn(),
      }),
    );
    const manifests = Array.from(document.querySelectorAll('.manifest-row'));
    const nativeManifest = manifests.find((row) => row.textContent?.includes('journal.csv'))!;
    expect(
      within(nativeManifest as HTMLElement).getByText(
        '2 rows · 11 non-posting rows (includes preamble/blanks)',
      ),
    ).toBeTruthy();
    expect(within(nativeManifest as HTMLElement).getByText('Scope unconfirmed')).toBeTruthy();
    expect(within(nativeManifest as HTMLElement).queryByText(/summaries excluded/)).toBeNull();
    const manualManifest = manifests.find((row) => row.textContent?.includes('st.csv'))!;
    expect(
      within(manualManifest as HTMLElement).getByText('1 rows · 0 summaries excluded'),
    ).toBeTruthy();
  });
  it('rejects an incompatible explicit header and allows deliberate recovery to native row 5', async () => {
    setup();
    selectNative();
    fireEvent.change(screen.getByLabelText('Expected report company name'), {
      target: { value: company },
    });
    scope();
    await files();
    await validate();
    const card = document.querySelectorAll('.mapping-card')[1] as HTMLElement;
    expect(Array.from(card.querySelectorAll('select')).every((select) => select.disabled)).toBe(
      true,
    );
    fireEvent.change(within(card).getByLabelText('Header row'), { target: { value: '6' } });
    await validate();
    expect(enabled()).toBe(false);
    expect(screen.getByText(/requires the native header at physical row 5/)).toBeTruthy();
    expect((within(card).getByLabelText('Header row') as HTMLInputElement).value).toBe('6');
    fireEvent.change(within(card).getByLabelText('Header row'), { target: { value: '5' } });
    await validate();
    expect(enabled()).toBe(true);
  });
  it('discards an old upload result when the selected profile changes mid-parse', async () => {
    setup();
    const gate = deferred<ParseResult>();
    vi.mocked(runImport).mockReturnValueOnce(gate.promise as never);
    startUpload('Choose QuickBooks CSV', 'stale.csv', new TextEncoder().encode(qb));
    await waitFor(() => expect(runImport).toHaveBeenCalledTimes(1));
    selectNative();
    expect(screen.getByText(/Settings changed while stale.csv was being read/)).toBeTruthy();
    const call = vi.mocked(runImport).mock.calls[0];
    const stale = await parseSource(call[0], 'QBO', call[2]);
    await act(async () => gate.resolve(stale));
    expect(screen.queryByRole('button', { name: /stale.csv/ })).toBeNull();
    expect(enabled()).toBe(false);
  });

  it('explains cancellation before arrayBuffer resolves and never parses the stale file', async () => {
    setup();
    const bytes = new TextEncoder().encode(qb);
    const gate = deferred<ArrayBuffer>();
    const file = new File([bytes], 'slow.csv');
    Object.defineProperty(file, 'arrayBuffer', { value: () => gate.promise });
    fireEvent.change(screen.getByLabelText('Choose QuickBooks CSV'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Period begins'), { target: { value: '2026-09-02' } });
    expect(screen.getByText(/Settings changed while slow.csv was being read/)).toBeTruthy();
    await act(async () => gate.resolve(bytes.buffer));
    expect(runImport).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /slow.csv/ })).toBeNull();
    expect(enabled()).toBe(false);
  });
  it('explains XLSX inspection cancellation without accepting or parsing stale bytes', async () => {
    setup();
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet(Papa.parse<string[]>(qb).data), 'GL');
    const bytes = new Uint8Array(write(book, { bookType: 'xlsx', type: 'array' }));
    const gate = deferred<Awaited<ReturnType<typeof runXlsxInspect>>>();
    vi.mocked(runXlsxInspect).mockReturnValueOnce(gate.promise);
    startUpload('Choose QuickBooks CSV', 'slow.xlsx', bytes);
    await waitFor(() => expect(runXlsxInspect).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Date format'), { target: { value: 'ISO' } });
    expect(screen.getByText(/Settings changed while slow.xlsx was being read/)).toBeTruthy();
    await act(async () => gate.resolve(inspectXlsx(bytes, 'slow.xlsx')));
    expect(runXlsxImport).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /slow.xlsx/ })).toBeNull();
    expect(enabled()).toBe(false);
  });
  it('passes other source bytes to preview and validation without double-counting replacements', async () => {
    setup();
    scope();
    await files(qb);
    const size = (text: string) => new TextEncoder().encode(text).byteLength;
    expect(vi.mocked(runImport).mock.calls.map((call) => call[2].existingTotalBytes)).toEqual([
      0,
      size(st),
      size(st) + size(qb),
    ]);
    await upload('Choose QuickBooks CSV', 'replacement.csv', qb);
    expect(vi.mocked(runImport).mock.calls.at(-1)![2].existingTotalBytes).toBe(
      size(st) + size(bank),
    );
    await validate();
    expect(
      vi
        .mocked(runImport)
        .mock.calls.slice(-3)
        .map((call) => call[2].existingTotalBytes),
    ).toEqual([size(qb) + size(bank), size(st) + size(bank), size(st) + size(qb)]);
  });
  it('keeps a newer upload when a cancelled parse finishes later', async () => {
    setup();
    const gate = deferred<ParseResult>();
    vi.mocked(runImport).mockReturnValueOnce(gate.promise as never);
    startUpload('Choose QuickBooks CSV', 'old.csv', new TextEncoder().encode(qb));
    await waitFor(() => expect(runImport).toHaveBeenCalledTimes(1));
    selectNative();
    fireEvent.change(screen.getByLabelText('Expected report company name'), {
      target: { value: company },
    });
    await upload('Choose QuickBooks CSV', 'new.csv', native);
    const call = vi.mocked(runImport).mock.calls[0];
    await act(async () => gate.resolve(await parseSource(call[0], 'QBO', call[2])));
    expect(screen.getByRole('button', { name: /new.csv/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /old.csv/ })).toBeNull();
    expect(screen.queryByText(/Settings changed while/)).toBeNull();
    expect(enabled()).toBe(false);
  });
  it('passes the other files budget through XLSX sheet changes and header reloads', async () => {
    setup();
    await upload('Choose ServiceTitan CSV', 'st.csv', st);
    await upload('Choose Bank CSV', 'bank.csv', bank);
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet(Papa.parse<string[]>(qb).data), 'GL');
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Synthetic note']]), 'Read me');
    startUpload(
      'Choose QuickBooks CSV',
      'budget.xlsx',
      new Uint8Array(write(book, { bookType: 'xlsx', type: 'array' })),
    );
    await screen.findByText('CHOOSE_WORKSHEET');
    fireEvent.change(screen.getByLabelText('Worksheet'), { target: { value: 'GL' } });
    await waitFor(() => expect(screen.queryByText('CHOOSE_WORKSHEET')).toBeNull());
    const expected = new TextEncoder().encode(st + bank).byteLength;
    expect(vi.mocked(runXlsxImport).mock.calls.at(-1)![2].existingTotalBytes).toBe(expected);
    const card = document.querySelectorAll('.mapping-card')[1] as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Reload selected header' }));
    await waitFor(() => expect(runXlsxImport).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        (within(card).getByRole('button', { name: 'Reload selected header' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(vi.mocked(runXlsxImport).mock.calls.at(-1)![2].existingTotalBytes).toBe(expected);
  });
  it('discards an old header preview and retains explicit header selection after profile change', async () => {
    setup();
    await upload('Choose QuickBooks CSV', 'qbo.csv', qb);
    const initial = await vi.mocked(runImport).mock.results[0].value;
    const card = document.querySelector('.mapping-card') as HTMLElement;
    fireEvent.change(within(card).getByLabelText('Header row'), { target: { value: '2' } });
    const gate = deferred<ParseResult>();
    vi.mocked(runImport).mockReturnValueOnce(gate.promise as never);
    fireEvent.click(within(card).getByRole('button', { name: 'Reload selected header' }));
    await waitFor(() => expect(runImport).toHaveBeenCalledTimes(2));
    selectNative();
    await act(async () => gate.resolve(initial));
    expect(screen.getByText('REPORT_SETTINGS_CHANGED')).toBeTruthy();
    expect((within(card).getByLabelText('Header row') as HTMLInputElement).value).toBe('2');
    expect(enabled()).toBe(false);
  });
  it('discards validation results after a profile change instead of enabling reconciliation', async () => {
    setup();
    scope();
    await files(qb);
    const initial = await vi.mocked(runImport).mock.results[0].value;
    const gate = deferred<ParseResult>();
    vi.mocked(runImport).mockReturnValueOnce(gate.promise as never);
    fireEvent.click(screen.getByLabelText(/I reviewed the mappings and source scope/));
    fireEvent.click(screen.getByRole('button', { name: 'Validate files' }));
    await waitFor(() => expect(runImport).toHaveBeenCalledTimes(4));
    selectNative();
    await act(async () => gate.resolve(initial));
    expect(runImport).toHaveBeenCalledTimes(4);
    expect(screen.queryByText('Validation passed')).toBeNull();
    expect(enabled()).toBe(false);
  });
  it('preserves an explicitly selected worksheet across report-profile changes', async () => {
    setup();
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet(Papa.parse<string[]>(native).data), 'Journal');
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Synthetic note']]), 'Read me');
    startUpload(
      'Choose QuickBooks CSV',
      'journal.xlsx',
      new Uint8Array(write(book, { bookType: 'xlsx', type: 'array' })),
    );
    await screen.findByText('CHOOSE_WORKSHEET');
    fireEvent.change(screen.getByLabelText('Worksheet'), { target: { value: 'Journal' } });
    await waitFor(() => expect(screen.queryByText('CHOOSE_WORKSHEET')).toBeNull());
    selectNative();
    expect((screen.getByLabelText('Worksheet') as HTMLSelectElement).value).toBe('Journal');
    expect(screen.getByText('REPORT_SETTINGS_CHANGED')).toBeTruthy();
    expect(enabled()).toBe(false);
  });
  it('preserves original native workbook formulas as controls and sends only complete posting legs', async () => {
    const onRun = setup();
    selectNative();
    scope();
    fireEvent.change(screen.getByLabelText('Expected report company name'), {
      target: { value: company },
    });
    const bytes = new Uint8Array(
      readFileSync('evidence/quickbooks-acceptance-20261021/target-transaction-journal-145.xlsx'),
    );
    const originalBytes = new Uint8Array(bytes);
    await upload('Choose ServiceTitan CSV', 'st.csv', st);
    startUpload('Choose QuickBooks CSV', 'native-formulas.xlsx', bytes);
    await screen.findByRole('button', { name: /native-formulas.xlsx/ });
    await upload('Choose Bank CSV', 'bank.csv', bank);
    await validate();
    expect(enabled()).toBe(true);
    expect(screen.getByText('Preserved source control formulas (never evaluated)')).toBeTruthy();
    expect(
      screen.getByText('Sheet1!H9: H7+H8 · CONSISTENT · stored 900 · independent cents 90000'),
    ).toBeTruthy();
    expect(
      screen.getByText('Sheet1!I10: I9 · CONSISTENT · stored 900 · independent cents 90000'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile these files' }));
    expect(onRun).toHaveBeenCalledTimes(1);
    const [input, sourceFiles] = onRun.mock.calls[0] as unknown as [
      Workspace['input'],
      Workspace['files'],
    ];
    expect(input.qb.map((r) => r.source_refs[0].physical_row)).toEqual([7, 8]);
    expect(input.qb.map((r) => r.transaction_id)).toEqual(['145', '145']);
    const report = input.manifests?.find((m) => m.source_system === 'QBO');
    expect(report?.coverage_confirmed).toBe(false);
    expect(report?.qbo_transaction_journal?.scope).toBe('TRANSACTION_GROUPS');
    expect(report?.qbo_transaction_journal?.groups[0].posting_physical_rows).toEqual([7, 8]);
    const source = sourceFiles.find((f) => f.kind === 'QBO');
    expect(source?.importStatus).toBe('READY');
    expect(source?.controls?.formulaCells).toHaveLength(4);
    expect(source?.controls?.formulaCells?.every((f) => f.status === 'CONSISTENT')).toBe(true);
    expect(source?.controls?.accountingBlockedTransactionIds).toEqual([]);
    expect(bytes).toEqual(originalBytes);
  });
});
