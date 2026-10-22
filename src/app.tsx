import { useRef, useState } from 'react';
import {
  initializeReview,
  serializeProject,
  openProject,
  MAX_PROJECT_BYTES,
} from './review/project';
import { downloadText } from './components/workspace';
import { ShieldCheck, Upload, Database, Layers, X, Trash2, Menu } from 'lucide-react';
import { runImport as parseSource } from './workers/import-client';
import type { ParseOptions, SourceKind } from './ingestion/types';
import type {
  ReconcileInput,
  EvidenceBundle,
  SettlementEvidence,
  AuditEvidence,
  ExternalReceiptEvidence,
  DepositComponentEvidence,
} from './contracts/engine';
import type { Bank_Deposit_Row, ST_Payment_Record, QB_Ledger_Entry } from './contracts/canonical';
import { runReconciliation } from './workers/client';
import { DeskPage, EmptyDesk } from './pages/desk';
import { ImportPage } from './pages/import';
import { ExportsPage } from './pages/exports';
import { SupplementalEvidence, type EvidenceScope } from './components/SupplementalEvidence';
import { Notice, Spinner, Modal } from './components/ui';
import { type Workspace, type SourceFile, dateLabel } from './components/workspace';
const demoOptions: ParseOptions = {
  companyId: 'SYNTHETIC_DEMO',
  bankAccountId: 'DEMO_BANK',
  companyTimezone: 'America/New_York',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  asOfDate: '2026-09-30',
  currency: 'USD',
  profile: 'synthetic-v1',
  rowGrain: 'PAYMENT',
  exportMode: 'JE_TO_CLEARING',
  postedLedgerConfirmed: true,
  bankPostedConfirmed: true,
  coverageConfirmed: true,
  basis: 'ACCRUAL',
};
export default function App() {
  const [importEpoch, setImportEpoch] = useState(0);
  const [page, setPage] = useState<'desk' | 'import' | 'exports'>('desk');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const currentWorkspace = useRef(workspace);
  currentWorkspace.current = workspace;
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const operation = useRef(0);
  function navigate(next: typeof page) {
    setPage(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  async function calculate(
    input: ReconcileInput,
    files: SourceFile[],
    options: ParseOptions,
    isDemo: boolean,
    token: number,
  ) {
    // A cancelled parser may finish after a newer run has started. It must not
    // abort that run or install a new worker before its stale token is checked.
    if (token !== operation.current) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setBusyLabel('Following each source link locally');
    const { result, duration_ms } = await runReconciliation(input, controller.signal);
    if (token !== operation.current) return;
    const next: Workspace = {
      input,
      result,
      duration: duration_ms,
      isDemo,
      files,
      options,
      runId: crypto.randomUUID(),
    };
    next.review = initializeReview(next, currentWorkspace.current?.review);
    setWorkspace(next);
    setPage('desk');
    setEvidenceOpen(false);
    setNotice('Reconciliation complete. Review evidence before any accounting action.');
  }
  async function loadDemo() {
    const token = ++operation.current;
    setBusy(true);
    setError('');
    setNotice('');
    setBusyLabel('Reading the three synthetic exports');
    try {
      const specs: [SourceKind, string][] = [
        ['ST', 'st_export.csv'],
        ['QBO', 'qbo_clearing_gl.csv'],
        ['BANK', 'chase_bank.csv'],
      ];
      const results = await Promise.all(
        specs.map(async ([kind, name]) => {
          const response = await fetch(`${import.meta.env.BASE_URL}demo/${name}`);
          if (!response.ok) throw new Error(`Sample file unavailable: ${name}.`);
          const text = await response.text();
          const parsed = await parseSource(text, kind, { ...demoOptions, fileName: name });
          if (!parsed.ok || !parsed.manifest)
            throw new Error(
              `${name}: ${parsed.issues.find((i) => i.severity === 'error')?.message ?? 'validation failed'}`,
            );
          return { kind, name, parsed };
        }),
      );
      if (token !== operation.current) return;
      const input: ReconcileInput = {
        st: results[0].parsed.rows as ST_Payment_Record[],
        qb: results[1].parsed.rows as QB_Ledger_Entry[],
        bank: results[2].parsed.rows as Bank_Deposit_Row[],
        manifests: results.map((r) => r.parsed.manifest!),
        config: {
          company_id: demoOptions.companyId,
          bank_account_id: demoOptions.bankAccountId,
          period_cutoff: demoOptions.periodEnd,
          qb_bank_account_names: ['Collections Checking'],
          clearing_split_semantics_confirmed: true,
        },
      };
      await calculate(
        input,
        results.map((r) => ({
          name: r.name,
          kind: r.kind,
          hash: r.parsed.manifest!.source_file_sha256,
        })),
        demoOptions,
        true,
        token,
      );
    } catch (e) {
      if (token === operation.current)
        setError(e instanceof Error ? e.message : 'Unable to load the sample.');
    } finally {
      if (token === operation.current) setBusy(false);
    }
  }
  async function runFiles(input: ReconcileInput, files: SourceFile[], options: ParseOptions) {
    const token = ++operation.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await calculate(input, files, options, false, token);
    } catch (e) {
      if (token === operation.current)
        setError(e instanceof Error ? e.message : 'Reconciliation failed.');
    } finally {
      if (token === operation.current) setBusy(false);
    }
  }
  async function addEvidenceEntries(
    entries: {
      kind: SourceKind;
      name: string;
      text: string;
      bytes?: Uint8Array;
      options: ParseOptions;
    }[],
  ) {
    if (!workspace) return;
    const token = ++operation.current;
    setBusy(true);
    setError('');
    setBusyLabel('Validating supporting evidence');
    const input = structuredClone(workspace.input);
    const files = [...workspace.files];
    const evidence: EvidenceBundle = input.evidence ?? {};
    try {
      for (const entry of entries) {
        const parsed = await parseSource(entry.text, entry.kind, {
          ...entry.options,
          fileName: entry.name,
          originalBytes: entry.bytes,
          seenFileHashes: files.map((f) => f.hash),
        });
        if (token !== operation.current) return;
        if (parsed.duplicate) continue;
        if (!parsed.ok || !parsed.manifest)
          throw new Error(
            `${entry.name}: ${parsed.issues.find((i) => i.severity === 'error')?.message ?? 'Evidence validation failed.'}`,
          );
        files.push({
          name: entry.name,
          kind: entry.kind,
          hash: parsed.manifest.source_file_sha256,
          sizeBytes: entry.bytes?.byteLength ?? new TextEncoder().encode(entry.text).byteLength,
          mapping: parsed.mapping,
          controls: parsed.controls,
          importStatus: parsed.status,
          parseOptions: entry.options,
        });
        input.manifests.push(parsed.manifest);
        if (entry.kind === 'QBO' || entry.kind === 'QBD')
          input.qb.push(...(parsed.rows as QB_Ledger_Entry[]));
        else if (entry.kind === 'BANK') input.bank.push(...(parsed.rows as Bank_Deposit_Row[]));
        else if (entry.kind === 'PROCESSOR')
          evidence.settlements = [
            ...(evidence.settlements ?? []),
            ...(parsed.rows as SettlementEvidence[]),
          ];
        else if (entry.kind === 'AUDIT')
          evidence.audit_events = [
            ...(evidence.audit_events ?? []),
            ...(parsed.rows as AuditEvidence[]),
          ];
        else if (entry.kind === 'RECEIPT')
          evidence.external_receipts = [
            ...(evidence.external_receipts ?? []),
            ...(parsed.rows as ExternalReceiptEvidence[]),
          ];
        else if (entry.kind === 'COMPONENT')
          evidence.deposit_components = [
            ...(evidence.deposit_components ?? []),
            ...(parsed.rows as DepositComponentEvidence[]),
          ];
      }
      input.evidence = evidence;
      await calculate(input, files, workspace.options, workspace.isDemo, token);
      if (token === operation.current)
        setNotice(
          'Supporting evidence added. Results were recalculated; no previous accounting approval was carried forward.',
        );
    } catch (e) {
      if (token === operation.current)
        setError(e instanceof Error ? e.message : 'Evidence import failed.');
      throw e;
    } finally {
      if (token === operation.current) setBusy(false);
    }
  }
  async function addDemoEvidence() {
    const fetchToken = ++operation.current;
    const specs: [SourceKind, string][] = [
      ['PROCESSOR', 'processor_settlements.csv'],
      ['AUDIT', 'st_audit_events.csv'],
      ['RECEIPT', 'external_receipts.csv'],
      ['COMPONENT', 'deposit_components.csv'],
      ['BANK', 'bank_next_period.csv'],
    ];
    setError('');
    setBusy(true);
    setBusyLabel('Reading the synthetic evidence pack');
    try {
      const entries = await Promise.all(
        specs.map(async ([kind, name]) => {
          const response = await fetch(`${import.meta.env.BASE_URL}demo/${name}`);
          if (!response.ok) throw new Error(`Sample evidence unavailable: ${name}.`);
          return {
            kind,
            name,
            text: await response.text(),
            options: {
              ...demoOptions,
              ...(kind === 'BANK'
                ? { periodStart: '2026-10-01', periodEnd: '2026-10-07', asOfDate: '2026-10-07' }
                : {}),
            },
          };
        }),
      );
      if (fetchToken !== operation.current) return;
      await addEvidenceEntries(entries);
    } catch (e) {
      if (fetchToken === operation.current)
        setError(e instanceof Error ? e.message : 'Evidence unavailable.');
      throw e;
    } finally {
      if (fetchToken === operation.current) setBusy(false);
    }
  }
  async function addFileEvidence(file: File, kind: SourceKind, scope: EvidenceScope) {
    if (!workspace || workspace.isDemo)
      throw new Error('Use a real-file workspace before adding local evidence.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Evidence file exceeds 10 MB.');
    if (!/\.(csv|tsv)$/i.test(file.name)) throw new Error('Evidence must be CSV / TSV.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    await addEvidenceEntries([
      {
        kind,
        name: file.name,
        text,
        bytes,
        options: {
          ...workspace.options,
          ...scope,
          profile: 'manual',
          existingTotalBytes: workspace.files.reduce((total, f) => total + (f.sizeBytes ?? 0), 0),
        },
      },
    ]);
  }
  async function restoreProject(file: File) {
    const token = ++operation.current;
    abortRef.current?.abort();
    setBusy(true);
    setBusyLabel('Validating saved review and recalculating');
    setError('');
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error('Review project exceeds 40 MB.');
      const text = await file.text();
      if (token !== operation.current) return;
      const restored = openProject(text);
      setWorkspace(restored);
      setImportEpoch((n) => n + 1);
      setPage('desk');
      setNotice(
        'Review project restored and recalculated. Prior export history retained; saved approvals require fresh review. Keep original source documents separately.',
      );
    } catch (e) {
      if (token === operation.current)
        setError(e instanceof Error ? e.message : 'Review project could not be opened.');
    } finally {
      if (token === operation.current) setBusy(false);
    }
  }
  function saveProject() {
    if (!workspace) return;
    try {
      downloadText(
        `review-project-${workspace.runId}.json`,
        serializeProject(workspace),
        'application/json',
      );
      setNotice(
        'Review project downloaded with normalized source rows, mappings and history. Keep original source documents separately.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save review project.');
    }
  }
  function clear() {
    operation.current++;
    abortRef.current?.abort();
    setBusy(false);
    setWorkspace(null);
    setImportEpoch((n) => n + 1);
    setError('');
    setNotice('In-memory workspace cleared. Downloaded files are not removed.');
    setClearOpen(false);
    setEvidenceOpen(false);
    navigate('desk');
  }
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to workspace
      </a>
      <header className="app-header">
        <button
          className="brand"
          onClick={() => navigate('desk')}
          aria-label="Reconciliation Desk home"
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>Reconciliation Desk</span>
        </button>
        <nav className={menuOpen ? 'main-nav open' : 'main-nav'} aria-label="Main navigation">
          {(['desk', 'import', 'exports'] as const).map((item) => (
            <button
              key={item}
              className={page === item ? 'active' : ''}
              onClick={() => navigate(item)}
              aria-current={page === item ? 'page' : undefined}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="header-end">
          <button className="privacy-button" onClick={() => setPrivacyOpen(true)}>
            <ShieldCheck size={18} />
            <span>Stays in this browser</span>
          </button>
          {workspace && (
            <button
              className="icon-button clear-button"
              onClick={() => setClearOpen(true)}
              aria-label="Clear workspace"
            >
              <Trash2 size={17} />
            </button>
          )}
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
          >
            <Menu size={21} />
          </button>
        </div>
      </header>
      <main id="main" className="app-main">
        <div className="page-heading">
          <div>
            <h1>
              {page === 'desk'
                ? 'Follow the money.'
                : page === 'import'
                  ? 'Import your month.'
                  : 'Review before you export.'}
            </h1>
            <p>
              {workspace
                ? `${dateLabel(workspace.options.periodStart)} – ${dateLabel(workspace.options.periodEnd)} · ${workspace.isDemo ? 'Synthetic sample · No customer data' : workspace.options.companyId}`
                : 'A clear view of receipts, ledger activity, and bank deposits.'}
            </p>
          </div>
          <div className="heading-actions">
            <label className="button button-secondary">
              Open review project
              <input
                aria-label="Open review project"
                type="file"
                accept=".json"
                hidden
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void restoreProject(f);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              className="button button-secondary"
              disabled={!workspace || busy}
              onClick={saveProject}
            >
              Save review project
            </button>
            {page !== 'import' && (
              <button
                className="button button-secondary"
                onClick={() => navigate('import')}
                disabled={busy}
              >
                <Upload size={17} />
                Import files
              </button>
            )}
            <button className="button button-primary" onClick={loadDemo} disabled={busy}>
              <Database size={17} />
              {workspace ? 'Reset sample month' : 'Load demo'}
            </button>
          </div>
        </div>
        {busy && (
          <div className="processing-bar">
            <Spinner label={busyLabel} />
            <button
              className="text-button"
              onClick={() => {
                operation.current++;
                abortRef.current?.abort();
                setBusy(false);
                setNotice('Run cancelled. Existing results were not changed.');
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {error && <Notice error>{error}</Notice>}
        {notice && (
          <div className="toast-notice" role="status">
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="Dismiss update"
              onClick={() => setNotice('')}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {page === 'desk' ? (
          workspace ? (
            <DeskPage
              workspace={workspace}
              onWorkspaceChange={setWorkspace}
              onAddEvidence={() => setEvidenceOpen(true)}
              onExportReview={() => navigate('exports')}
            />
          ) : (
            <EmptyDesk onDemo={loadDemo} onImport={() => navigate('import')} busy={busy} />
          )
        ) : page === 'import' ? null : (
          <ExportsPage workspace={workspace} />
        )}
        <div hidden={page !== 'import'}>
          <ImportPage key={importEpoch} onRun={runFiles} busy={busy} onDemo={loadDemo} />
        </div>
        <footer className="app-footer">
          <span>
            <ShieldCheck size={14} />
            Read-only by design. Export is not posting.
          </span>
          <button className="text-button" onClick={() => setPrivacyOpen(true)}>
            Privacy & limits
          </button>
        </footer>
      </main>
      {evidenceOpen && workspace && (
        <SupplementalEvidence
          isDemo={workspace.isDemo}
          hasEnhanced={workspace.files.some((f) => f.kind === 'PROCESSOR')}
          scope={{
            periodStart: workspace.options.periodStart,
            periodEnd: workspace.options.periodEnd,
            asOfDate: workspace.options.asOfDate,
          }}
          busy={busy}
          onClose={() => setEvidenceOpen(false)}
          onDemo={addDemoEvidence}
          onFile={addFileEvidence}
        />
      )}{' '}
      {clearOpen && (
        <Modal title="Clear this workspace?" onClose={() => setClearOpen(false)}>
          <p>
            Remove all source rows, reconciliation results, and in-memory review state. Files you
            downloaded or selected on your device are not deleted.
          </p>
          <div className="button-row">
            <button className="button button-secondary" onClick={() => setClearOpen(false)}>
              Keep workspace
            </button>
            <button className="button button-danger" onClick={clear}>
              Clear workspace
            </button>
          </div>
        </Modal>
      )}
      {privacyOpen && (
        <Modal title="Your data, kept local" onClose={() => setPrivacyOpen(false)}>
          <div className="privacy-copy">
            <ShieldCheck size={32} />
            <p>
              Files are parsed in this browser. Reconciliation runs in a local Web Worker. There are
              no financial-account connections, analytics, model calls, or transaction uploads.
            </p>
            <h3>What is retained</h3>
            <p>
              Current source data and review state live only in memory. Reloading or clearing the
              workspace removes them. Downloads remain on your device.
            </p>
            <h3>What this build supports</h3>
            <p>
              Single-company, single-bank, USD activity reconciliation with UTF-8 CSV / TSV and
              guarded, values-only XLSX imports. PDF extraction, real QuickBooks import
              compatibility, and production ledger validation are not claimed.
            </p>
            <h3>Evidence, not automatic approval</h3>
            <p>
              Missing records remain unknown. Financial adjustments require verified account and
              posting evidence. A download never becomes “verified in QuickBooks” without
              re-imported ledger evidence.
            </p>
            {workspace && (
              <button
                className="button button-secondary"
                onClick={() => {
                  setPrivacyOpen(false);
                  setClearOpen(true);
                }}
              >
                <Trash2 size={16} />
                Clear workspace
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
