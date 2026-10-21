import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Upload,
  FileText,
  Check,
  ArrowRight,
  RotateCcw,
  ShieldCheck,
  ChevronDown,
} from 'lucide-react';
import { runImport as parseSource } from '../workers/import-client';
import { runXlsxImport, runXlsxInspect } from '../workers/xlsx-client';
import type { ParseOptions, ParseResult, SourceKind, ColumnBindings } from '../ingestion/types';
import { requiredFields } from '../mapping/aliases';
import type { ReconcileInput } from '../contracts/engine';
import type { ST_Payment_Record, QB_Ledger_Entry, Bank_Deposit_Row } from '../contracts/canonical';
import { Notice, Status, Spinner } from '../components/ui';
import { money, humanize, type SourceFile } from '../components/workspace';
type MainKind = 'ST' | 'QBO' | 'BANK';
interface FileState {
  file: File;
  text: string;
  bytes: Uint8Array;
  result: ParseResult;
  bindings?: ColumnBindings;
  headerRow?: number;
  excludedTargets?: string[];
  isXlsx?: boolean;
  sheetName?: string;
  sheets?: { name: string; hidden: boolean }[];
}
const names: Record<MainKind, string> = { ST: 'ServiceTitan', QBO: 'QuickBooks', BANK: 'Bank' };
const extraFields: Record<MainKind, string[]> = {
  ST: [
    'source_payment_id',
    'accounting_batch_id',
    'payment_method',
    'payment_status',
    'export_status',
    'reference',
  ],
  QBO: [
    'transaction_id',
    'line_id',
    'num',
    'split_account',
    'accounting_batch_id',
    'linked_payment_id',
    'linked_deposit_id',
  ],
  BANK: [
    'description_local',
    'source_transaction_id',
    'deposit_id',
    'trace_id',
    'bank_type',
    'pending',
  ],
};
export function ImportPage({
  onRun,
  busy,
  onDemo,
}: {
  onRun: (input: ReconcileInput, files: SourceFile[], options: ParseOptions) => Promise<void>;
  busy: boolean;
  onDemo: () => void;
}) {
  const [files, setFiles] = useState<Partial<Record<MainKind, FileState>>>({});
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [validated, setValidated] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [qbProduct, setQbProduct] = useState<'QBO' | 'QBD'>('QBO');
  const [qbReportProfile, setQbReportProfile] = useState<'manual' | 'qbo-transaction-journal-v1'>(
    'manual',
  );
  const [reportCompanyName, setReportCompanyName] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [periodStart, setPeriodStart] = useState('2026-09-01');
  const [periodEnd, setPeriodEnd] = useState('2026-09-30');
  const [asOfDate, setAsOfDate] = useState('2026-09-30');
  const [timezone, setTimezone] = useState('America/New_York');
  const [clearing, setClearing] = useState('');
  const [bankName, setBankName] = useState('');
  const [exportMode, setExportMode] = useState<ParseOptions['exportMode']>('UNKNOWN');
  const [rowGrain, setRowGrain] = useState<ParseOptions['rowGrain']>('PAYMENT');
  const [uf, setUf] = useState(false);
  const [dateFormat, setDateFormat] = useState<'MDY' | 'ISO'>('MDY');
  const parseToken = useRef(0);
  const nativeJournal = qbProduct === 'QBO' && qbReportProfile === 'qbo-transaction-journal-v1';
  useEffect(
    () => () => {
      ++parseToken.current;
    },
    [],
  );
  const options = (semantic = false): ParseOptions => ({
    companyId: companyId.trim() || 'unconfirmed-local-company',
    bankAccountId: bankAccountId.trim() || 'unconfirmed-local-bank',
    companyTimezone: timezone,
    periodStart,
    periodEnd,
    asOfDate,
    currency: 'USD',
    profile: 'manual',
    dateFormat,
    rowGrain,
    exportMode,
    postedLedgerConfirmed: semantic,
    bankPostedConfirmed: semantic,
    bankSignConvention: semantic ? 'INFLOW_POSITIVE' : undefined,
    coverageConfirmed: semantic,
    basis: semantic ? 'ACCRUAL' : 'UNKNOWN',
    bankName: bankName.trim(),
    accountMap: clearing.trim()
      ? {
          [clearing.trim()]: {
            accountType: 'OTHER_CURRENT_ASSET',
            role: 'CLEARING',
            isUndepositedFunds: uf,
          },
        }
      : {},
  });
  const invalidate = () => {
    ++parseToken.current;
    setReading(false);
    setValidated(false);
    setConfirmed(false);
  };
  function invalidateQbPreview() {
    invalidate();
    setError('');
    setFiles((previous) => {
      const source = previous.QBO;
      if (!source) return previous;
      return {
        ...previous,
        QBO: {
          ...source,
          bindings: undefined,
          excludedTargets: [],
          result: {
            ok: false,
            rows: [],
            manifest: null,
            mapping: null,
            duplicate: false,
            controls: { signedCents: 0, debitCents: null, creditCents: null, excludedRows: [] },
            issues: [
              {
                code: 'REPORT_SETTINGS_CHANGED',
                severity: 'error',
                message:
                  'QuickBooks report settings changed. Reload the selected header or validate again. Existing worksheet and header choices are retained.',
              },
            ],
          },
        },
      };
    });
  }
  async function readFile(kind: MainKind, file: File) {
    setError('');
    invalidate();
    setReading(true);
    const token = ++parseToken.current;
    try {
      if (!/\.(csv|tsv|xlsx)$/i.test(file.name))
        throw new Error(
          'Choose CSV, TSV, or XLSX. Macro-enabled workbooks, PDFs, and accounting backup files are not supported.',
        );
      if (file.size > 10 * 1024 * 1024)
        throw new Error(`${file.name} exceeds the 10 MB per-file limit.`);
      const total =
        Object.entries(files).reduce(
          (sum, [key, value]) => sum + (key === kind ? 0 : (value?.file.size ?? 0)),
          0,
        ) + file.size;
      if (total > 30 * 1024 * 1024)
        throw new Error('The total import exceeds 30 MB. Narrow the report period.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isXlsx = /\.xlsx$/i.test(file.name);
      const text = isXlsx ? '' : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const inspection = isXlsx ? await runXlsxInspect(bytes, file.name) : null;
      const sheetName =
        inspection && !inspection.requiresSheetSelection ? inspection.sheets[0].name : undefined;
      const source: FileState = {
        file,
        text,
        bytes,
        isXlsx,
        sheetName,
        sheets: inspection?.sheets,
        result: {
          ok: false,
          rows: [],
          manifest: null,
          issues: [],
          mapping: null,
          duplicate: false,
          controls: { signedCents: 0, debitCents: null, creditCents: null, excludedRows: [] },
        },
      };
      const result = inspection?.requiresSheetSelection
        ? {
            ...source.result,
            issues: [
              {
                code: 'CHOOSE_WORKSHEET',
                message: 'Choose one worksheet explicitly. Sheets are never silently combined.',
                severity: 'error' as const,
              },
            ],
          }
        : await parseFile(source, kind, options());
      if (token !== parseToken.current) return;
      setFiles((previous) => ({
        ...previous,
        [kind]: {
          ...source,
          result,
          bindings: result.mapping?.bindings,
          headerRow: result.mapping?.headerRow,
        },
      }));
    } catch (e) {
      if (token === parseToken.current)
        setError(e instanceof Error ? e.message : 'File reading failed.');
    } finally {
      if (token === parseToken.current) setReading(false);
    }
  }
  function parseFile(source: FileState, kind: MainKind, settings: ParseOptions) {
    const resolvedKind = kind === 'QBO' ? qbProduct : kind;
    const opts: ParseOptions = {
      ...settings,
      ...(kind === 'QBO' && nativeJournal
        ? {
            profile: 'qbo-transaction-journal-v1',
            qboTransactionJournalCompanyName: reportCompanyName.trim(),
            coverageConfirmed: false,
          }
        : {}),
      fileName: source.file.name,
      originalBytes: source.bytes,
    };
    return source.isXlsx
      ? runXlsxImport(source.bytes, resolvedKind, { ...opts, sheetName: source.sheetName })
      : parseSource(source.text, resolvedKind, opts);
  }
  async function changeSheet(kind: MainKind, sheetName: string) {
    const source = files[kind];
    if (!source) return;
    invalidate();
    const token = ++parseToken.current;
    setReading(true);
    setError('');
    try {
      const next = {
        ...source,
        sheetName,
        headerRow: undefined,
        bindings: undefined,
        excludedTargets: [],
      };
      const result = await parseFile(next, kind, options());
      if (token !== parseToken.current) return;
      setFiles((previous) => ({
        ...previous,
        [kind]: {
          ...next,
          result,
          bindings: result.mapping?.bindings,
          headerRow: result.mapping?.headerRow,
        },
      }));
    } catch (e) {
      if (token === parseToken.current)
        setError(e instanceof Error ? e.message : 'Worksheet preview failed.');
    } finally {
      if (token === parseToken.current) setReading(false);
    }
  }
  async function previewHeader(kind: MainKind) {
    const source = files[kind];
    if (!source) return;
    setError('');
    invalidate();
    const token = ++parseToken.current;
    setReading(true);
    try {
      const result = await parseFile(source, kind, {
        ...options(),
        headerRow:
          source.headerRow ??
          source.result.mapping?.headerRow ??
          (kind === 'QBO' && nativeJournal ? 5 : 1),
      });
      if (token !== parseToken.current) return;
      setFiles((previous) => ({
        ...previous,
        [kind]: {
          ...source,
          result,
          bindings: result.mapping?.bindings,
          headerRow: source.headerRow ?? result.mapping?.headerRow,
          excludedTargets: [],
        },
      }));
    } catch (e) {
      if (token === parseToken.current)
        setError(e instanceof Error ? e.message : 'Header preview failed.');
    } finally {
      if (token === parseToken.current) setReading(false);
    }
  }
  async function validate() {
    const token = ++parseToken.current;
    setError('');
    setReading(true);
    setValidated(false);
    try {
      if (
        !companyId.trim() ||
        !bankAccountId.trim() ||
        !clearing.trim() ||
        exportMode === 'UNKNOWN'
      )
        throw new Error(
          'Complete the local company, bank label, clearing account, and ServiceTitan export mode before validation.',
        );
      if (!confirmed)
        throw new Error('Confirm the report semantics and coverage before validation.');
      if (nativeJournal && !reportCompanyName.trim())
        throw new Error(
          'Enter the independently reviewed company name printed on the QBO Transaction Journal.',
        );
      const next: Partial<Record<MainKind, FileState>> = {};
      let seen: string[] = [];
      for (const kind of ['ST', 'QBO', 'BANK'] as MainKind[]) {
        const source = files[kind];
        if (!source) throw new Error(`Choose a ${names[kind]} file first.`);
        const result = await parseFile(source, kind, {
          ...options(true),
          bindings: source.bindings,
          excludedTargets: source.excludedTargets,
          // Approved column bindings belong to the resolved physical header, not
          // to every candidate row considered by automatic header detection.
          headerRow: source.headerRow ?? source.result.mapping?.headerRow,
          seenFileHashes: seen,
        });
        if (token !== parseToken.current) return;
        if (result.manifest) seen.push(result.manifest.source_file_sha256);
        next[kind] = { ...source, result };
      }
      setFiles(next);
      setValidated(Object.values(next).every((f) => f?.result.ok));
      if (!Object.values(next).every((f) => f?.result.ok))
        setError(
          'Some files need attention. Review the validation messages below; no reconciliation has run.',
        );
    } catch (e) {
      if (token === parseToken.current)
        setError(e instanceof Error ? e.message : 'Validation failed.');
    } finally {
      if (token === parseToken.current) setReading(false);
    }
  }
  async function run() {
    if (!validated) return;
    const st = files.ST!,
      qb = files.QBO!,
      bank = files.BANK!;
    const sourceFiles = (
      [
        ['ST', st],
        ['QBO', qb],
        ['BANK', bank],
      ] as [MainKind, FileState][]
    ).map(([kind, f]) => ({
      kind: kind === 'QBO' ? qbProduct : kind,
      name: f.file.name,
      hash: f.result.manifest!.source_file_sha256,
      sizeBytes: f.file.size,
    }));
    await onRun(
      {
        st: st.result.rows as ST_Payment_Record[],
        qb: qb.result.rows as QB_Ledger_Entry[],
        bank: bank.result.rows as Bank_Deposit_Row[],
        manifests: [st.result.manifest!, qb.result.manifest!, bank.result.manifest!],
        config: {
          company_id: companyId.trim(),
          bank_account_id: bankAccountId.trim(),
          period_cutoff: periodEnd,
          clearing_split_semantics_confirmed: false,
        },
      },
      sourceFiles,
      { ...options(true), coverageConfirmed: nativeJournal ? false : true },
    );
  }
  const present = Object.keys(files).length;
  return (
    <div className="import-page">
      <div className="section-intro">
        <div>
          <h2>Bring the evidence together.</h2>
          <p>Three local exports, reviewed before a single match is made.</p>
        </div>
        <button className="text-button" onClick={onDemo} disabled={busy || reading}>
          Explore the sample instead <ArrowRight size={16} />
        </button>
      </div>
      <Notice>
        <strong>Your files stay in this browser.</strong> This build supports UTF-8 CSV / TSV and
        guarded XLSX (values only; no formulas, macros, or external links). No raw transactions are
        uploaded, no model is called, and no accounting system is changed. Clear workspace removes
        the in-memory data.
      </Notice>
      <div className="import-steps">
        <span className={present < 3 ? 'current' : 'complete'}>
          <b>{present === 3 ? <Check size={14} /> : '1'}</b>Choose files
        </span>
        <span className={present === 3 && !validated ? 'current' : ''}>
          <b>2</b>Map & confirm
        </span>
        <span className={validated ? 'current' : ''}>
          <b>3</b>Review quality
        </span>
      </div>
      <div className="upload-grid">
        {(['ST', 'QBO', 'BANK'] as MainKind[]).map((kind) => (
          <UploadCard
            key={kind}
            kind={kind}
            state={files[kind]}
            disabled={busy || reading}
            onFile={(file) => readFile(kind, file)}
            onSheet={(sheet) => changeSheet(kind, sheet)}
          />
        ))}
      </div>
      {error && <Notice error>{error}</Notice>}
      <section className="import-settings panel">
        <h3>Define this reconciliation</h3>
        <p className="body-muted">
          Use local labels, not full account numbers. Coverage is your statement about the reports
          you supplied.
        </p>
        <div className="form-grid" onChange={invalidate}>
          <label>
            Company label
            <input
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              placeholder="e.g. Northside Services"
              required
            />
          </label>
          <label>
            Bank account label
            <input
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              placeholder="e.g. Operating checking"
              required
            />
          </label>
          <label>
            QuickBooks product
            <select
              value={qbProduct}
              disabled={busy}
              onChange={(e) => {
                setQbProduct(e.target.value as 'QBO' | 'QBD');
                setQbReportProfile('manual');
                invalidateQbPreview();
              }}
            >
              <option value="QBO">QuickBooks Online</option>
              <option value="QBD">QuickBooks Desktop</option>
            </select>
          </label>
          {qbProduct === 'QBO' && (
            <label>
              QuickBooks report profile
              <select
                value={qbReportProfile}
                disabled={busy}
                onChange={(e) => {
                  setQbReportProfile(e.target.value as typeof qbReportProfile);
                  invalidateQbPreview();
                }}
              >
                <option value="manual">Manual column mapping (default)</option>
                <option value="qbo-transaction-journal-v1">
                  Native QBO Transaction Journal (scoped evidence)
                </option>
              </select>
            </label>
          )}
          {nativeJournal && (
            <label>
              Expected report company name
              <input
                value={reportCompanyName}
                disabled={busy}
                required
                placeholder="Exact company name printed on the report"
                onChange={(e) => {
                  setReportCompanyName(e.target.value);
                  invalidateQbPreview();
                }}
              />
            </label>
          )}
          <label>
            Company time zone
            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/New_York"
            />
          </label>
          <label>
            Period begins
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </label>
          <label>
            Period ends
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </label>
          <label>
            Evidence observed through
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </label>
          <label>
            Clearing account, exact GL name
            <input
              value={clearing}
              onChange={(e) => setClearing(e.target.value)}
              placeholder="ServiceTitan Clearing"
              required
            />
          </label>
          <label>
            ServiceTitan export mode
            <select
              value={exportMode}
              onChange={(e) => setExportMode(e.target.value as ParseOptions['exportMode'])}
            >
              <option value="UNKNOWN">Choose the verified workflow</option>
              <option value="JE_TO_CLEARING">Journal entries to asset clearing</option>
              <option value="PAYMENT_TO_UF">Payments to Undeposited Funds</option>
              <option value="FINANCE_WORKFLOW">Financing workflow (review only)</option>
            </select>
          </label>
          <label>
            Payment report grain
            <select
              value={rowGrain}
              onChange={(e) => setRowGrain(e.target.value as ParseOptions['rowGrain'])}
            >
              <option value="PAYMENT">One row per actual payment</option>
              <option value="PAYMENT_APPLICATION">Payment applications (repeated payment)</option>
              <option value="BATCH_SUMMARY">One row per batch summary</option>
            </select>
          </label>
          <label>
            Date format
            <select
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value as 'MDY' | 'ISO')}
            >
              <option value="MDY">MM/DD/YYYY</option>
              <option value="ISO">YYYY-MM-DD</option>
            </select>
          </label>
          <label>
            Bank name (optional)
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Bank name"
            />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={uf} onChange={(e) => setUf(e.target.checked)} />
            This account uses Undeposited Funds
          </label>
        </div>
        {nativeJournal && (
          <Notice>
            <strong>Transaction-only evidence, not full-period coverage.</strong> Choose this
            profile explicitly for the native QBO Transaction Journal and independently verify its
            printed company name. It supports only the reported journals, not the entire clearing
            account or month. Native CSV is the primary route. XLSX formulas, macros and external
            links remain blocked; nothing is silently stripped. This profile uses fixed report
            columns and physical header row 5, never Num as a transaction ID.
          </Notice>
        )}
      </section>
      {present > 0 && (
        <section className="mapping-section">
          <h3>Review column meanings</h3>
          <p className="body-muted">
            Suggestions come from a local alias dictionary. Choose source columns explicitly when an
            amount or date is ambiguous.
          </p>
          {(['ST', 'QBO', 'BANK'] as MainKind[])
            .filter((kind) => files[kind])
            .map((kind) => (
              <MappingCard
                key={kind}
                kind={kind}
                state={files[kind]!}
                onPreview={() => previewHeader(kind)}
                disabled={reading || busy}
                fixedJournalProfile={kind === 'QBO' && nativeJournal}
                onChange={(bindings, headerRow, excludedTargets) => {
                  setFiles((previous) => ({
                    ...previous,
                    [kind]: { ...previous[kind]!, bindings, headerRow, excludedTargets },
                  }));
                  invalidate();
                }}
              />
            ))}
        </section>
      )}
      <div className="quality-confirmation panel">
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              setValidated(false);
            }}
          />
          <span>
            {nativeJournal
              ? 'I reviewed the mappings and source scope. The QB file is a posted accrual Transaction Journal for the expected company, not Bank Feed “For review”. Bank rows are posted with inflows positive and outflows negative; the selected payment grain, export mode and account are correct. This confirms only the reported journals, not full-period QB coverage.'
              : 'I reviewed the mappings and source scope. The QB file is posted accrual ledger activity, not Bank Feed “For review”; bank rows are posted with inflows positive and outflows negative; the selected payment grain, export mode, account, and date coverage are correct.'}
          </span>
        </label>
        <p className="body-muted">
          This does not confirm a cause, approve any adjustment, or prove a month-end account
          balance.
        </p>
        <div className="button-row">
          <button
            className="button button-secondary"
            disabled={present !== 3 || !confirmed || busy || reading}
            onClick={validate}
          >
            {reading ? (
              <Spinner label="Validating locally" />
            ) : (
              <>
                <Check size={16} />
                Validate files
              </>
            )}
          </button>
          <button
            className="button button-primary"
            disabled={!validated || busy || reading}
            onClick={run}
          >
            {busy ? (
              <Spinner label="Reconciling" />
            ) : (
              <>
                Reconcile these files
                <ArrowRight size={16} />
              </>
            )}
          </button>
          {validated && <Status tone="green">Validation passed</Status>}
        </div>
      </div>
    </div>
  );
}
function UploadCard({
  kind,
  state,
  disabled,
  onFile,
  onSheet,
}: {
  kind: MainKind;
  state?: FileState;
  disabled: boolean;
  onFile: (file: File) => void;
  onSheet: (sheet: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  function drop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (!disabled && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
  }
  return (
    <div
      className={`upload-card ${state ? 'has-file' : ''} ${drag ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={drop}
    >
      <div className="upload-title">
        <span className="source-monogram">
          {kind === 'QBO' ? 'QB' : kind === 'BANK' ? 'BK' : kind}
        </span>
        <h3>{names[kind]}</h3>
        {state && <Check size={17} />}
      </div>
      <p>
        {kind === 'ST'
          ? 'Payments with actual receipt amounts'
          : kind === 'QBO'
            ? 'General Ledger with debit / credit columns'
            : 'Posted credits and debits for one account'}
      </p>
      <input
        ref={ref}
        type="file"
        accept=".csv,.tsv,.xlsx,text/csv,text/tab-separated-values"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.[0]) onFile(e.target.files[0]);
          e.target.value = '';
        }}
        aria-label={`Choose ${names[kind]} CSV`}
      />
      <button className="file-picker" onClick={() => ref.current?.click()} disabled={disabled}>
        {state ? <FileText size={21} /> : <Upload size={23} />}
        <strong>{state ? state.file.name : 'Drop an export or choose a file'}</strong>
        <span>
          {state
            ? `${(state.file.size / 1024).toFixed(1)} KB · Click to replace`
            : 'CSV / TSV / XLSX · Up to 10 MB'}
        </span>
      </button>
      {state?.isXlsx && (
        <label className="sheet-picker">
          Worksheet
          <select
            value={state.sheetName ?? ''}
            disabled={disabled}
            onChange={(e) => onSheet(e.target.value)}
          >
            <option value="">Choose one worksheet</option>
            {state.sheets?.map((sheet) => (
              <option key={sheet.name} value={sheet.name}>
                {sheet.name}
                {sheet.hidden ? ' (hidden)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
function MappingCard({
  kind,
  state,
  onChange,
  onPreview,
  disabled,
  fixedJournalProfile,
}: {
  kind: MainKind;
  state: FileState;
  onPreview: () => void;
  disabled: boolean;
  fixedJournalProfile: boolean;
  onChange: (bindings: ColumnBindings, headerRow?: number, excludedTargets?: string[]) => void;
}) {
  const mapping = state.result.mapping;
  const fields =
    fixedJournalProfile && mapping
      ? Object.keys(mapping.bindings)
      : [
          ...new Set([
            ...requiredFields[kind],
            ...extraFields[kind],
            ...Object.keys(state.bindings ?? {}),
          ]),
        ];
  return (
    <details className="mapping-card panel" open={!state.result.ok}>
      <summary>
        <span>
          <strong>{names[kind]}</strong>
          <span>{state.file.name}</span>
        </span>
        <Status tone={state.result.ok ? 'green' : 'amber'}>
          {state.result.ok ? `${state.result.rows.length} valid rows` : 'Review needed'}
        </Status>
      </summary>
      <div className="mapping-body">
        <div className="mapping-meta">
          <span>
            {mapping
              ? `Detected header: physical row ${mapping.headerRow}`
              : 'No header resolved. Select the physical header row explicitly.'}
          </span>
          <label>
            Header row
            <input
              type="number"
              min="1"
              max="30"
              value={state.headerRow ?? mapping?.headerRow ?? (fixedJournalProfile ? 5 : 1)}
              disabled={disabled || (state.isXlsx && !state.sheetName)}
              onChange={(e) =>
                onChange(state.bindings ?? {}, Number(e.target.value), state.excludedTargets)
              }
            />
          </label>
          <button
            className="text-button"
            onClick={onPreview}
            disabled={disabled || (state.isXlsx && !state.sheetName)}
          >
            Reload selected header
          </button>
        </div>
        {mapping && (
          <div className="mapping-grid">
            {fields.map((field) => (
              <label key={field}>
                {humanize(field)}
                {requiredFields[kind].includes(field) && <span className="required-star"> *</span>}
                <select
                  value={
                    (fixedJournalProfile ? mapping.bindings[field] : state.bindings?.[field]) ?? ''
                  }
                  disabled={disabled || fixedJournalProfile}
                  onChange={(e) => {
                    const next = { ...state.bindings };
                    let excluded = [...(state.excludedTargets ?? [])];
                    if (e.target.value === '') {
                      delete next[field];
                      excluded = [...new Set([...excluded, field])];
                    } else {
                      next[field] = Number(e.target.value);
                      excluded = excluded.filter((target) => target !== field);
                    }
                    onChange(next, state.headerRow, excluded);
                  }}
                >
                  <option value="">Not mapped</option>
                  {mapping.headers.map((header, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        {fixedJournalProfile && mapping && (
          <p className="body-muted">
            Fixed native report columns are shown above. Transaction IDs come from validated group
            rows, not the Num column. Posting lines retain their own physical row references.
          </p>
        )}
        {state.result.manifest && (
          <div className="import-control-row">
            <span>
              {state.result.manifest.raw_row_count}{' '}
              {fixedJournalProfile ? 'nonempty records after header' : 'source rows'}
            </span>
            <span>{state.result.manifest.normalized_row_count} normalized</span>
            <span>
              {state.result.manifest.excluded_summary_rows.length}{' '}
              {fixedJournalProfile
                ? 'non-posting rows (includes preamble/blanks)'
                : 'summaries excluded'}
            </span>
            <span>Signed activity: {money(state.result.controls.signedCents)}</span>
            {fixedJournalProfile && (
              <>
                <span>Debit total: {money(state.result.controls.debitCents ?? 0)}</span>
                <span>Credit total: {money(state.result.controls.creditCents ?? 0)}</span>
              </>
            )}
          </div>
        )}
        {fixedJournalProfile && state.result.manifest && (
          <details>
            <summary>Non-posting physical rows and classifications</summary>
            <ul className="validation-list">
              {state.result.controls.excludedRows.map((row) => (
                <li key={row.physicalRow}>
                  Row {row.physicalRow}: {row.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {state.result.issues.length > 0 && (
          <ul className="validation-list">
            {state.result.issues.map((issue, i) => (
              <li key={i} className={issue.severity === 'error' ? 'validation-error' : ''}>
                <strong>
                  {issue.physicalRow ? `Row ${issue.physicalRow}: ` : ''}
                  {issue.code}
                </strong>{' '}
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
