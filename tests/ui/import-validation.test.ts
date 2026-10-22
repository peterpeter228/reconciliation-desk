// @vitest-environment jsdom
// Real parsers run through mocked worker transports. This is not browser-worker proof.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { utils, write } from 'xlsx';
import { ImportPage } from '../../src/pages/import';
import { runImport } from '../../src/workers/import-client';
import { runXlsxImport } from '../../src/workers/xlsx-client';
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
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.mocked(runImport).mockClear();
  vi.mocked(runXlsxImport).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const source = (name: string) => readFileSync(`samples/${name}`, 'utf8');
async function upload(label: string, name: string, text: string) {
  await uploadBytes(label, name, new TextEncoder().encode(text));
}
async function uploadBytes(label: string, name: string, bytes: Uint8Array<ArrayBuffer>) {
  const file = new File([bytes], name);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
  await screen.findByRole('button', { name: new RegExp(name.replaceAll('.', '\\.')) });
  await waitFor(
    () =>
      expect(
        (screen.getByRole('button', { name: /Explore the sample instead/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    { timeout: 10000 },
  );
}
function setup() {
  render(createElement(ImportPage, { onRun: vi.fn(async () => {}), busy: false, onDemo: vi.fn() }));
}
async function loadAll(st = source('st_export.csv')) {
  await upload('Choose ServiceTitan CSV', 'st_export.csv', st);
  await upload('Choose QuickBooks CSV', 'qbo_clearing_gl.csv', source('qbo_clearing_gl.csv'));
  await upload('Choose Bank CSV', 'chase_bank.csv', source('chase_bank.csv'));
}
async function validate() {
  fireEvent.change(screen.getByLabelText('Company label'), { target: { value: 'SYNTHETIC_QA' } });
  fireEvent.change(screen.getByLabelText('Bank account label'), {
    target: { value: 'Synthetic checking' },
  });
  fireEvent.change(screen.getByLabelText('Clearing account, exact GL name'), {
    target: { value: 'ServiceTitan Clearing' },
  });
  fireEvent.change(screen.getByLabelText('ServiceTitan export mode'), {
    target: { value: 'JE_TO_CLEARING' },
  });
  fireEvent.click(screen.getByLabelText(/I reviewed the mappings and source scope/));
  fireEvent.click(screen.getByRole('button', { name: 'Validate files' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Validate files' })).toBeTruthy(), {
    timeout: 12000,
  });
}
describe('Resolved import headers survive validation (real parsers, jsdom)', () => {
  it('retains the selected XLSX sheet and resolved header through validation', async () => {
    setup();
    const book = utils.book_new();
    utils.book_append_sheet(
      book,
      utils.aoa_to_sheet(
        Papa.parse<string[]>(source('st_export.csv'), { skipEmptyLines: true }).data,
      ),
      'Payments',
    );
    utils.book_append_sheet(book, utils.aoa_to_sheet([['Synthetic QA only']]), 'Read me');
    const bytes = new Uint8Array(write(book, { bookType: 'xlsx', type: 'array' }));
    await uploadBytes('Choose ServiceTitan CSV', 'synthetic-multisheet.xlsx', bytes);
    expect(screen.getByText('CHOOSE_WORKSHEET')).toBeTruthy();
    expect(vi.mocked(runXlsxImport).mock.calls).toHaveLength(0);
    const card = document.querySelector('.mapping-card') as HTMLElement;
    expect(
      (within(card).getByRole('button', { name: 'Reload selected header' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Worksheet'), { target: { value: 'Payments' } });
    await waitFor(() => expect(screen.queryByText('CHOOSE_WORKSHEET')).toBeNull());
    await upload('Choose QuickBooks CSV', 'qbo_clearing_gl.csv', source('qbo_clearing_gl.csv'));
    await upload('Choose Bank CSV', 'chase_bank.csv', source('chase_bank.csv'));
    await validate();
    const call = vi.mocked(runXlsxImport).mock.calls.find((c) => c[2].coverageConfirmed);
    expect(call?.[2].sheetName).toBe('Payments');
    expect(call?.[2].headerRow).toBe(1);
    expect(screen.getByText('Validation passed')).toBeTruthy();
  });
  it('preserves detected physical header rows with the approved bindings', async () => {
    setup();
    await loadAll();
    await validate();
    const calls = vi.mocked(runImport).mock.calls.filter((c) => c[2].coverageConfirmed);
    expect(calls.map((c) => c[2].headerRow)).toEqual([1, 1, 1]);
    expect(screen.getByText('Validation passed')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Reconcile these files' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
  it('retains an explicit header override instead of reverting to automatic detection', async () => {
    setup();
    await loadAll('Report title\n' + source('st_export.csv'));
    const card = document.querySelector('.mapping-card') as HTMLElement;
    fireEvent.change(within(card).getByLabelText('Header row'), { target: { value: '2' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Reload selected header' }));
    await waitFor(() =>
      expect(
        (within(card).getByRole('button', { name: 'Reload selected header' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    await validate();
    const stCall = vi
      .mocked(runImport)
      .mock.calls.slice()
      .reverse()
      .find((c) => c[1] === 'ST' && c[2].coverageConfirmed);
    expect(stCall?.[2].headerRow).toBe(2);
    expect(screen.getByText('Validation passed')).toBeTruthy();
  });
  it('keeps manual header recovery visible and never silently selects the first ambiguous row', async () => {
    setup();
    const csv = 'Payment ID,Payment Date,Payment Amount\nPayment ID,Paid On,Gross Amount\n';
    await upload('Choose ServiceTitan CSV', 'ambiguous.csv', csv);
    const card = document.querySelector('.mapping-card') as HTMLElement;
    expect(within(card).getByText(/Ambiguous header rows/)).toBeTruthy();
    expect(within(card).getByLabelText('Header row')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Reload selected header' })).toBeTruthy();
    expect(vi.mocked(runImport).mock.calls).toHaveLength(1);
    fireEvent.change(within(card).getByLabelText('Header row'), { target: { value: '2' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Reload selected header' }));
    await waitFor(() => expect(vi.mocked(runImport).mock.calls).toHaveLength(2));
    expect(vi.mocked(runImport).mock.calls[1][2].headerRow).toBe(2);
  });
});
