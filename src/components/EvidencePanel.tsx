import { AlertTriangle, Check, ArrowRight, Plus, FileSearch, Info } from 'lucide-react';
import type { EngineGroup, EdgeAssessment } from '../contracts/engine';
import { money, humanize, causeNames } from './workspace';
import { Status } from './ui';
const edgeLabels: Record<EdgeAssessment['kind'], string> = {
  ST_QB_RECEIPT: 'ST → QuickBooks',
  QB_BANK_SETTLEMENT: 'QuickBooks → Bank',
  ST_BANK_CASH: 'ST / processor → Bank',
};
export function EvidencePanel({
  group,
  onAddEvidence,
  onExportReview,
}: {
  group: EngineGroup;
  onAddEvidence: () => void;
  onExportReview: () => void;
}) {
  const missing = [
    ...new Set([
      ...group.edges.flatMap((e) => e.missing_evidence),
      ...group.diagnoses.flatMap((d) => d.missing_evidence),
    ]),
  ];
  const parts: [string, number][] = [
    ['Gross receipts', group.gross_cents],
    ['Refunds', -group.refunds_cents],
    ['Documented fees', -group.fees_cents],
    ['Held funds', -group.holds_cents],
    ['Hold releases', group.releases_cents],
    ['External receipts', group.external_receipts_cents],
    ['Other adjustments', group.other_adjustments_cents],
  ];
  return (
    <>
      <div className="edge-strip">
        {group.edges.map((edge) => (
          <div key={edge.kind} className="edge-item">
            <span
              className={`edge-icon ${edge.state === 'CONFIRMED' ? 'verified' : edge.state === 'SUPPORTED' ? 'supported' : 'unverified'}`}
            >
              {edge.state === 'CONFIRMED' ? (
                <Check size={13} />
              ) : edge.state === 'SUPPORTED' ? (
                <Info size={13} />
              ) : (
                <AlertTriangle size={13} />
              )}
            </span>
            <div>
              <strong>{edgeLabels[edge.kind]}</strong>
              <Status
                tone={
                  edge.state === 'CONFIRMED'
                    ? 'green'
                    : edge.state === 'SUPPORTED'
                      ? 'blue'
                      : 'amber'
                }
              >
                {humanize(edge.state)}
              </Status>
              <small>
                {edge.state === 'CONFIRMED'
                  ? 'Identity and amount evidence.'
                  : edge.state === 'SUPPORTED'
                    ? 'Association, not full posting proof.'
                    : 'More evidence is needed.'}
              </small>
            </div>
          </div>
        ))}
      </div>
      <section className="diagnostic-panel">
        <div className="diagnostic-title">
          <div>
            <FileSearch size={19} />
            <h3>What the evidence tells us</h3>
          </div>
          <button className="button button-small button-secondary" onClick={onAddEvidence}>
            <Plus size={15} />
            Add evidence
          </button>
        </div>
        {group.diagnoses.length ? (
          <div className="diagnoses">
            {group.diagnoses.map((d, index) => (
              <div className="diagnosis" key={`${d.cause}-${index}`}>
                <div>
                  <strong>{causeNames[d.cause]}</strong>
                  <Status tone={d.evidence_level === 'CONFIRMED' ? 'green' : 'amber'}>
                    {humanize(d.evidence_level)}
                  </Status>
                </div>
                <span className="evidence-score">
                  Evidence score {d.score}/100, not a probability
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="body-muted">
            No specific exception cause has been established. The three source links are assessed
            independently.
          </p>
        )}
        {missing.length > 0 && (
          <div className="missing-evidence">
            <strong>Still needed</strong>
            <ul>
              {missing.slice(0, 5).map((item) => (
                <li key={item}>{humanize(item)}</li>
              ))}
            </ul>
            {missing.length > 5 && (
              <details>
                <summary>{missing.length - 5} more evidence requirements</summary>
                <ul>
                  {missing.slice(5).map((item) => (
                    <li key={item}>{humanize(item)}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {group.warnings.length > 0 && (
          <details className="inline-details">
            <summary>Scope and rule notes ({group.warnings.length})</summary>
            <ul>
              {group.warnings.map((w, index) => (
                <li key={index}>{humanize(w)}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <details className="bridge-details">
        <summary>
          <span>Amount bridge & accounting eligibility</span>
          <span className="summary-amount">{money(group.unexplained_cents)} unexplained</span>
        </summary>
        <div className="bridge-content">
          <dl className="amount-bridge">
            {parts
              .filter(([, amount], index) => amount !== 0 || index === 0)
              .map(([label, amount]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{money(amount)}</dd>
                </div>
              ))}
            <div className="bridge-total">
              <dt>Observed bank activity</dt>
              <dd>{money(group.bank_cents)}</dd>
            </div>
            <div>
              <dt>Unexplained difference</dt>
              <dd>{money(group.unexplained_cents)}</dd>
            </div>
          </dl>
          <div className="eligibility-note">
            <strong>
              {group.fee_aje_draft_eligible
                ? 'Eligible for a separate accounting review'
                : 'No import-ready adjustment'}
            </strong>
            <p>
              {group.fee_proposal_math_ready
                ? 'The fee workpaper is mathematically supported. Full QB bank and expense evidence is still required before an import proposal.'
                : 'A matching amount or fee-rate band alone cannot authorize an entry.'}
            </p>
            <button className="text-button" onClick={onExportReview}>
              Review export eligibility <ArrowRight size={14} />
            </button>
            <small>
              Clearing residual {money(group.ledger_residual_cents)} · Search{' '}
              {humanize(group.search_status)}
            </small>
          </div>
        </div>
      </details>
    </>
  );
}
