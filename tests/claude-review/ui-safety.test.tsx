// @vitest-environment jsdom
// Component/App regressions in jsdom. Not real-browser acceptance.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import App from '../../src/app';
import { CaseReview } from '../../src/components/CaseReview';
import * as workspaceModule from '../../src/components/workspace';
import { serializeProject, reviewForGroup } from '../../src/review/project';
import { runImport } from '../../src/workers/import-client';
import { runReconciliation } from '../../src/workers/client';
import type { ImportManifest } from '../../src/contracts/canonical';
import type { ParseResult } from '../../src/ingestion/types';
import type { ReconcileResult } from '../../src/contracts/engine';
import type { Workspace } from '../../src/components/workspace';
import { sessionWorkspace, feeGroup, documentedFacts, withFacts } from './fee-case-fixture';
vi.mock('../../src/workers/import-client', () => ({ runImport: vi.fn() }));
vi.mock('../../src/workers/client', () => ({ runReconciliation: vi.fn() }));
vi.mock('../../src/workers/xlsx-client', () => ({
  runXlsxInspect: vi.fn(),
  runXlsxImport: vi.fn(),
}));
const emptyResult = (): ReconcileResult => ({
  groups: [],
  controls: {
    st_gross_cents: 0,
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
});
let downloads: { name: string; content: string }[] = [];
beforeEach(() => {
  // jsdom lacks modal dialogs; the real-browser run exercises the native element.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
  downloads = [];
  window.localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, text: async () => 'synthetic test fixture' })),
  );
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(workspaceModule, 'downloadText').mockImplementation((name, content) => {
    downloads.push({ name, content });
  });
  vi.mocked(runReconciliation)
    .mockReset()
    .mockImplementation(async () => ({ result: emptyResult(), duration_ms: 1 }));
  vi.mocked(runImport)
    .mockReset()
    .mockImplementation(
      async (_text, kind, options) =>
        ({
          ok: true,
          rows: [],
          manifest: {
            company_id: options.companyId,
            source_system: kind,
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

async function openRealProject() {
  const base = await sessionWorkspace();
  const text = serializeProject(withFacts(base, documentedFacts(base)));
  render(<App />);
  const input = screen.getByLabelText('Open review project') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, {
      target: { files: [new File([text], 'synthetic.review.json', { type: 'application/json' })] },
    });
  });
  await waitFor(() => expect(screen.getAllByText(/Synthetic HVAC Co/).length).toBeGreaterThan(0));
}

describe('F-02 replacing a workspace with unsaved review work', () => {
  it('asks before the demo replaces a real workspace with unsaved review edits', async () => {
    await openRealProject();
    fireEvent.change(screen.getByLabelText('Reviewer'), {
      target: { value: 'Synthetic reviewer (edited)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset sample month' }));
    expect(screen.getByText(/Replace this workspace\?/)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Synthetic HVAC Co/).length).toBeGreaterThan(0);
  });
  it('never carries real review facts into a synthetic demo project', async () => {
    await openRealProject();
    fireEvent.change(screen.getByLabelText('Reviewer'), {
      target: { value: 'Synthetic reviewer (edited)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset sample month' }));
    const confirm = screen.queryByRole('button', { name: 'Replace workspace' });
    if (confirm) fireEvent.click(confirm);
    await waitFor(() => expect(screen.getAllByText(/Synthetic sample/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Save review project' }));
    const saved = downloads.find((d) => d.name.startsWith('review-project-'))!;
    expect(saved.content).not.toContain('Synthetic reviewer (edited)');
    expect(saved.content).not.toContain('Synthetic HVAC Co');
  });
});

function renderCase(w: Workspace, onChange = vi.fn()) {
  const g = feeGroup(w);
  return { g, view: render(<CaseReview workspace={w} group={g} onChange={onChange} />), onChange };
}
const ufPayment = {
  qbPaymentId: 'QB-PAY-1',
  amountCents: 1000000,
  inUndepositedFunds: true,
  existingDepositId: null,
  depositStatusReviewed: true,
  statusEvidenceRef: 'qb-payments-to-deposit:row4',
};
function ufWorksheet(): { status: string; missingEvidence: string[]; steps: string[] } {
  fireEvent.click(screen.getByRole('button', { name: 'Download UF review worksheet' }));
  const file = downloads.find((d) => d.name.startsWith('uf-worksheet-'));
  expect(file).toBeTruthy();
  return JSON.parse(file!.content);
}

describe('F-04 UF reviewed instructions ignore contradicting GL and other cases', () => {
  it('stays a candidate when the GL already shows the posted bank deposit for this case', async () => {
    const base = await sessionWorkspace();
    const w = withFacts(base, { ...documentedFacts(base), ufPayments: [ufPayment] } as never);
    renderCase(w);
    const sheet = ufWorksheet();
    expect(sheet.status).toBe('CANDIDATE');
    expect(sheet.missingEvidence.join(' ')).toMatch(/posted bank deposit/i);
    expect(sheet.steps.join(' ')).not.toMatch(/select these existing QB Payments/);
  });
  it('stays a candidate when the same QB Payment is listed for another case', async () => {
    const base = await sessionWorkspace();
    const w = withFacts(base, { ...documentedFacts(base), ufPayments: [ufPayment] } as never);
    const g = feeGroup(w);
    const other = w.review!.cases.find((c) => c.engineGroupId !== g.id)!;
    other.reviewedFacts = { ufPayments: [ufPayment] };
    renderCase(w);
    expect(ufWorksheet().missingEvidence.join(' ')).toMatch(/also listed/i);
  });
});

describe('F-09 an export from this browser is remembered beyond the in-memory project', () => {
  it('blocks a second journal from a stale copy of the same case after one export', async () => {
    const base = await sessionWorkspace();
    const stale = withFacts(base, documentedFacts(base));
    let current = structuredClone(stale);
    const onChange = vi.fn((next: Workspace) => {
      current = next;
    });
    const first = renderCase(current, onChange);
    const rerender = () =>
      first.view.rerender(
        <CaseReview workspace={current} group={feeGroup(current)} onChange={onChange} />,
      );
    fireEvent.click(screen.getByRole('button', { name: 'Build supported fee-only draft' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    rerender();
    fireEvent.click(screen.getByLabelText(/I reviewed these exact accounts/));
    fireEvent.click(screen.getByRole('button', { name: 'Approve exact proposal' }));
    await waitFor(() =>
      expect(reviewForGroup(current.review!, first.g.id)!.proposal?.state).toBe('APPROVED'),
    );
    rerender();
    fireEvent.click(screen.getByRole('button', { name: 'Download approved QBO CSV' }));
    await waitFor(() => expect(downloads.some((d) => d.name.endsWith('.csv'))).toBe(true));
    cleanup();
    downloads = [];
    // Reopen the project copy saved before the export: in-memory history is absent there.
    renderCase(structuredClone(stale));
    fireEvent.click(screen.getByRole('button', { name: 'Build supported fee-only draft' }));
    await waitFor(() => expect(screen.getByText(/already exported .*this browser/i)).toBeTruthy());
  });
});

describe('UF reviewed instructions: synthetic full-evidence positive and negatives', () => {
  async function ufCase(patch: (f: Record<string, unknown>, w: Workspace) => void = () => {}) {
    const base = await sessionWorkspace('uf');
    const facts = {
      ...documentedFacts(base),
      clearingAccountName: 'Undeposited Funds',
      ledgerCoveredAccountNames: [
        'Undeposited Funds',
        'Accounts Receivable',
        'Collections Checking',
        'Merchant Processing Fees',
      ].join('\n'),
      ufPayments: [{ ...ufPayment }],
    } as Record<string, unknown>;
    patch(facts, base);
    const w = withFacts(base, facts as never);
    renderCase(w);
    return ufWorksheet();
  }
  it('gives reviewed selection instructions only with actual QB payment, UF status and evidence', async () => {
    const sheet = await ufCase();
    expect(sheet.status).toBe('REVIEWED_INSTRUCTIONS');
    expect(sheet.missingEvidence).toEqual([]);
    expect(sheet.steps.join(' ')).toContain('select these existing QB Payments: QB-PAY-1');
    expect(sheet.steps.join(' ')).toContain('negative -900.00 USD fee line');
    expect(sheet.steps.join(' ')).toMatch(/Match any existing Bank Feed item/);
  });
  it.each([
    ['already deposited', (f: any) => (f.ufPayments[0].existingDepositId = 'QB-DEP-7')],
    ['missing QB payment', (f: any) => (f.ufPayments = [])],
    ['amount not conserved', (f: any) => (f.ufPayments[0].amountCents = 999999)],
    ['status not reviewed', (f: any) => (f.ufPayments[0].depositStatusReviewed = false)],
    [
      'fee already in GL',
      (_f: any, w: Workspace) =>
        w.input.qb.push({
          ...w.input.qb[0],
          id: 'qb-extra-fee',
          transaction_id: 'SYN-QB-FEE',
          account_full_name: 'Merchant Processing Fees',
          account_type: 'EXPENSE',
          role: 'FEE',
          debit_cents: 90000,
          credit_cents: 0,
          signed_cents: 90000,
        }),
    ],
  ])('keeps %s as a candidate without selection steps', async (_label, patch) => {
    const sheet = await ufCase(patch as never);
    expect(sheet.status).toBe('CANDIDATE');
    expect(sheet.steps.join(' ')).not.toContain('select these existing QB Payments');
  });
});

describe('Unsaved review work', () => {
  it('warns before reload only while review edits are unsaved', async () => {
    await openRealProject();
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'Edited reviewer' } });
    expect(screen.getByText('Unsaved review changes')).toBeTruthy();
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save review project' }));
    expect(screen.queryByText('Unsaved review changes')).toBeNull();
    const saved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });
  it('keeps the workspace and unsaved protection when a confirmed replacement fails', async () => {
    await openRealProject();
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'Edited reviewer' } });
    const input = screen.getByLabelText('Open review project') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['{"schemaVersion":999}'], 'bad.review.json')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Replace workspace' }));
    await waitFor(() => expect(screen.getByText(/Review project validation failed/)).toBeTruthy());
    expect(screen.getAllByText(/Synthetic HVAC Co/).length).toBeGreaterThan(0);
    expect(screen.getByText('Unsaved review changes')).toBeTruthy();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });
  it('shows reopened sources as unverified and keeps investigation available', async () => {
    await openRealProject();
    expect(screen.getByText('4 of 4 not re-verified')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Build supported fee-only draft' }));
    await waitFor(() =>
      expect(screen.getAllByText(/Re-attach the original source files/).length).toBeGreaterThan(0),
    );
    expect(screen.getByRole('button', { name: 'Download reviewer summary (HTML)' })).toBeTruthy();
  });
});

describe('Export reservation waits for the cross-tab lock', () => {
  it('does not download or commit when the case closes while the lock is held elsewhere', async () => {
    const base = await sessionWorkspace();
    let current = withFacts(base, documentedFacts(base));
    const onChange = vi.fn((next: Workspace) => {
      current = next;
    });
    const view = renderCase(current, onChange);
    const rerender = () =>
      view.view.rerender(
        <CaseReview workspace={current} group={feeGroup(current)} onChange={onChange} />,
      );
    fireEvent.click(screen.getByRole('button', { name: 'Build supported fee-only draft' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    rerender();
    fireEvent.click(screen.getByLabelText(/I reviewed these exact accounts/));
    fireEvent.click(screen.getByRole('button', { name: 'Approve exact proposal' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    rerender();
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: {
        request: async (_name: string, cb: () => unknown) => {
          await held;
          return cb();
        },
      },
    });
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent.click(screen.getByRole('button', { name: 'Download approved QBO CSV' }));
    await new Promise((r) => setTimeout(r, 20));
    view.view.unmount();
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(downloads.some((d) => d.name.endsWith('.csv'))).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
    // Reserved inside the lock, then released because nothing was downloaded.
    expect(writes.mock.calls.map((c) => JSON.parse(c[1] as string).length)).toEqual([1, 0]);
    expect(window.localStorage.getItem('reconciliation-desk.export-register.v1')).toBe('[]');
  });
});
