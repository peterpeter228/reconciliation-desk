import { useEffect, useState } from 'react';
import {
  Download,
  FileCheck2,
  ArrowRight,
  ShieldCheck,
  Layers,
  Database,
  CircleCheck,
  Info,
} from 'lucide-react';
import { ExceptionList } from '../components/ExceptionList';
import { SourceGrid } from '../components/SourceGrid';
import { EvidencePanel } from '../components/EvidencePanel';
import { Status, Notice } from '../components/ui';
import {
  money,
  groupTitle,
  isReview,
  downloadEvidence,
  humanize,
  type Workspace,
} from '../components/workspace';
export function EmptyDesk({
  onDemo,
  onImport,
  busy,
}: {
  onDemo: () => void;
  onImport: () => void;
  busy: boolean;
}) {
  return (
    <div className="welcome panel">
      <div className="welcome-copy">
        <div className="welcome-mark">
          <Layers size={28} />
        </div>
        <h2>
          Three exports.
          <br />
          One clear evidence trail.
        </h2>
        <p>
          See what was collected, what the books recorded, and what reached the bank. Keep the
          unknowns visible.
        </p>
        <div className="button-row">
          <button className="button button-primary" onClick={onDemo} disabled={busy}>
            <Database size={17} />
            Try a sample month
            <ArrowRight size={16} />
          </button>
          <button className="button button-secondary" onClick={onImport} disabled={busy}>
            Use my files
          </button>
        </div>
        <div className="welcome-assurance">
          <ShieldCheck size={16} />
          Local processing. No financial accounts connected.
        </div>
      </div>
      <div className="welcome-evidence">
        <div className="welcome-evidence-heading">
          <span>Your evidence, side by side</span>
          <span>USD</span>
        </div>
        {[
          ['01', 'ServiceTitan', 'Actual payments, not invoice totals'],
          ['02', 'QuickBooks', 'Posted ledger, with debits and credits'],
          ['03', 'Bank', 'Posted activity, including debits'],
        ].map(([num, name, description]) => (
          <div className="welcome-source" key={num}>
            <span>{num}</span>
            <div>
              <strong>{name}</strong>
              <p>{description}</p>
            </div>
            <FileCheck2 size={21} />
          </div>
        ))}
        <div className="welcome-foot">
          <Info size={16} />
          <span>
            A late settlement is not automatically a hold. A fee-rate match is not proof of a fee.
          </span>
        </div>
      </div>
    </div>
  );
}
export function DeskPage({
  workspace,
  onAddEvidence,
  onExportReview,
}: {
  workspace: Workspace;
  onAddEvidence: () => void;
  onExportReview: () => void;
}) {
  const sorted = [...workspace.result.groups].sort(
    (a, b) => b.impact_cents - a.impact_cents || a.id.localeCompare(b.id),
  );
  const [selectedId, setSelectedId] = useState(sorted[0]?.id);
  useEffect(() => {
    if (!workspace.result.groups.some((g) => g.id === selectedId)) setSelectedId(sorted[0]?.id);
  }, [workspace]);
  const group = workspace.result.groups.find((g) => g.id === selectedId) ?? sorted[0];
  const reviewCount = workspace.result.groups.filter(isReview).length;
  const feeAmount = workspace.result.groups
    .filter((g) => g.fee_proposal_math_ready)
    .reduce((sum, g) => sum + g.fees_cents, 0);
  const allBalanceVerified =
    workspace.result.controls.accounts.length > 0 &&
    workspace.result.controls.accounts.every((a) => a.status === 'VERIFIED');
  return (
    <>
      <div className="metrics-strip">
        <div>
          <span>ST gross receipts</span>
          <strong>{money(workspace.result.controls.st_gross_cents)}</strong>
          <small>Positive source payments</small>
        </div>
        <div>
          <span>Review queue</span>
          <strong>
            {reviewCount} <span className="metric-unit">cases</span>
          </strong>
          <small>Not an economic-event count</small>
        </div>
        <div>
          <span>Supported fee workpapers</span>
          <strong>{feeAmount ? money(feeAmount) : 'Evidence needed'}</strong>
          <small>Not approved accounting entries</small>
        </div>
        <div>
          <span>Activity reconciliation</span>
          <strong className="metric-message">
            {allBalanceVerified ? 'Account controls verified' : 'Balance verification incomplete'}
          </strong>
          <small>
            {allBalanceVerified
              ? 'Three-way status remains independent'
              : 'Opening / closing evidence may be missing'}
          </small>
        </div>
      </div>
      <div className="workbench">
        <ExceptionList workspace={workspace} selectedId={group?.id} onSelect={setSelectedId} />
        {group ? (
          <section className="case-panel panel" aria-label="Selected case evidence">
            <div className="case-heading">
              <div>
                <h2>{groupTitle(group)}</h2>
                <p>
                  ServiceTitan <ArrowRight size={13} />
                  QuickBooks <ArrowRight size={13} />
                  Bank
                </p>
              </div>
              <div className="case-amount">
                <strong>{money(group.impact_cents)}</strong>
                <Status tone={group.matching_scope === 'VERIFIED_THREE_WAY' ? 'green' : 'amber'}>
                  {group.matching_scope === 'VERIFIED_THREE_WAY'
                    ? 'Verified three-way'
                    : 'Activity bridge'}
                </Status>
              </div>
            </div>
            <div className="case-caption">
              <Info size={16} />
              <span>
                Equal amounts are not proof of the same transaction. Each source link needs its own
                evidence.
              </span>
            </div>
            <SourceGrid group={group} workspace={workspace} />
            <EvidencePanel
              group={group}
              onAddEvidence={onAddEvidence}
              onExportReview={onExportReview}
            />
            <div className="case-actions">
              <button
                className="button button-secondary button-small"
                onClick={() => downloadEvidence(workspace)}
              >
                <Download size={16} />
                Download evidence JSON
              </button>
              <button className="button button-quiet button-small" onClick={onExportReview}>
                <FileCheck2 size={16} />
                Review export eligibility
              </button>
            </div>
          </section>
        ) : (
          <section className="panel empty-result">
            <CircleCheck size={30} />
            <h2>No reconciliation cases</h2>
            <p>
              No eligible activity was produced. Check the import coverage and validation notes.
            </p>
          </section>
        )}
      </div>
      <details className="run-audit panel">
        <summary>
          <span>Run controls & import manifest</span>
          <span>
            {workspace.duration.toFixed(1)} ms engine · {workspace.files.length} files
          </span>
        </summary>
        <div className="run-audit-body">
          <Notice>
            Results cover the supplied activity only. File download is not posting. No data is
            written to ServiceTitan, QuickBooks, or your bank.
          </Notice>
          <div className="audit-facts">
            <div>
              <span>Conservation</span>
              <strong>
                {workspace.result.controls.conservation_ok
                  ? 'Passed for eligible source atoms'
                  : 'Requires review'}
              </strong>
            </div>
            <div>
              <span>Incomplete search scopes</span>
              <strong>{workspace.result.searches.filter((s) => !s.complete).length}</strong>
            </div>
            <div>
              <span>Rule version</span>
              <strong>{workspace.result.versions.rules}</strong>
            </div>
            <div>
              <span>Run ID</span>
              <strong className="break-anywhere">{workspace.runId}</strong>
            </div>
          </div>
          {workspace.input.manifests.map((m) => (
            <div key={m.source_file_sha256} className="manifest-row">
              <strong>
                {workspace.files.find((f) => f.hash === m.source_file_sha256)?.name ??
                  m.report_name}
              </strong>
              <span>
                {m.normalized_row_count} rows · {m.excluded_summary_rows.length}{' '}
                {m.qbo_transaction_journal
                  ? 'non-posting rows (includes preamble/blanks)'
                  : 'summaries excluded'}
              </span>
              <span>
                {m.period_start} – {m.period_end}
              </span>
              <Status tone={m.coverage_confirmed ? 'green' : 'amber'}>
                {m.coverage_confirmed ? 'Scope confirmed' : 'Scope unconfirmed'}
              </Status>
            </div>
          ))}
          {workspace.result.controls.accounts.map((a) => (
            <div className="manifest-row" key={a.account_id}>
              <strong>{a.account_full_name}</strong>
              <span>
                Debit {money(a.debit_cents)} · Credit {money(a.credit_cents)}
              </span>
              <span>
                Opening {a.opening_cents === null ? 'not supplied' : money(a.opening_cents)}
              </span>
              <Status tone={a.status === 'VERIFIED' ? 'green' : 'amber'}>
                {humanize(a.status)}
              </Status>
            </div>
          ))}
          {workspace.result.warnings.length > 0 && (
            <ul className="audit-warnings">
              {workspace.result.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </>
  );
}
