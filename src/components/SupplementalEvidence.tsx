import { useState } from 'react';
import { Upload, Database, ShieldCheck } from 'lucide-react';
import { Modal, Notice, Spinner } from './ui';
import type { SourceKind } from '../ingestion/types';
export interface EvidenceScope {
  periodStart: string;
  periodEnd: string;
  asOfDate: string;
}
export function SupplementalEvidence({
  isDemo,
  hasEnhanced,
  busy,
  scope,
  onClose,
  onDemo,
  onFile,
}: {
  isDemo: boolean;
  hasEnhanced: boolean;
  busy: boolean;
  scope: EvidenceScope;
  onClose: () => void;
  onDemo: () => Promise<void>;
  onFile: (file: File, kind: SourceKind, scope: EvidenceScope) => Promise<void>;
}) {
  const [dates, setDates] = useState(scope);
  const [kind, setKind] = useState<SourceKind>('PROCESSOR');
  const [file, setFile] = useState<File | null>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  async function addDemo() {
    setError('');
    try {
      await onDemo();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sample evidence could not be loaded.');
    }
  }
  async function submit() {
    if (!file) return;
    setError('');
    try {
      await onFile(file, kind, dates);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evidence import failed.');
    }
  }
  return (
    <Modal title="Add supporting evidence" onClose={onClose}>
      <p className="body-muted">
        New evidence creates a fresh reconciliation run. It does not carry forward an accounting
        approval.
      </p>
      {isDemo && (
        <div className="demo-evidence-option">
          <Database size={25} />
          <div>
            <strong>Synthetic evidence pack</strong>
            <p>
              Processor statements, deposit components, office receipts, audit events, and
              next-period bank activity.
            </p>
            <button
              className="button button-primary button-small"
              disabled={busy || hasEnhanced}
              onClick={() => void addDemo()}
            >
              {busy ? (
                <Spinner label="Recalculating" />
              ) : hasEnhanced ? (
                'Sample evidence already loaded'
              ) : (
                'Add sample evidence & recalculate'
              )}
            </button>
          </div>
        </div>
      )}
      <div className="form-stack">
        <label>
          Evidence type
          <select value={kind} onChange={(e) => setKind(e.target.value as SourceKind)}>
            <option value="PROCESSOR">Processor settlement statement</option>
            <option value="COMPONENT">Deposit component manifest</option>
            <option value="RECEIPT">External receipt / deposit evidence</option>
            <option value="AUDIT">ServiceTitan audit events</option>
            <option value="BANK">Next-period bank activity</option>
          </select>
        </label>
        <label>
          Choose a CSV file
          <input
            type="file"
            accept=".csv,.tsv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="supplemental-scope">
          <label>
            Evidence period begins
            <input
              type="date"
              value={dates.periodStart}
              onChange={(e) => {
                setDates({ ...dates, periodStart: e.target.value });
                setAck(false);
              }}
            />
          </label>
          <label>
            Evidence period ends
            <input
              type="date"
              value={dates.periodEnd}
              onChange={(e) => {
                setDates({ ...dates, periodEnd: e.target.value });
                setAck(false);
              }}
            />
          </label>
          <label>
            Observed through
            <input
              type="date"
              value={dates.asOfDate}
              onChange={(e) => {
                setDates({ ...dates, asOfDate: e.target.value });
                setAck(false);
              }}
            />
          </label>
        </div>
        <label className="checkbox-line">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>
            I reviewed this evidence type and its scope. Bank activity, if supplied, contains posted
            transactions with inflows positive and outflows negative, not pending entries. The dates
            above describe the supplied evidence coverage.
          </span>
        </label>
        <Notice>
          Supported supplemental columns must be present. Unknown or ambiguous layouts are blocked.
          Actual files must not be mixed into a synthetic demonstration.
        </Notice>
        {error && <Notice error>{error}</Notice>}
        <button
          className="button button-secondary"
          onClick={submit}
          disabled={!file || !ack || busy || isDemo}
        >
          <Upload size={16} />
          Validate & add local evidence
        </button>
        {isDemo && (
          <small className="body-muted">Start with “Import files” to use your own evidence.</small>
        )}
      </div>
    </Modal>
  );
}
