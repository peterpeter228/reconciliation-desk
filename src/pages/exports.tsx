import { useEffect, useRef, useState } from 'react';
import {
  Download,
  FileText,
  FileCheck2,
  LockKeyhole,
  ArrowRight,
  Printer,
  Check,
} from 'lucide-react';
import {
  buildFeeProposal,
  createTeachingFeeCase,
  approveProposal,
  type FeeProposal,
} from '../export/aje';
import { exportQboCsv } from '../export/qbo';
import { exportQbdIif } from '../export/qbd';
import {
  money,
  downloadText,
  downloadEvidence,
  humanize,
  type Workspace,
} from '../components/workspace';
import { Notice, Status, Spinner } from '../components/ui';
import { evidenceCsv } from '../export/evidence';
import { approvalMatchesView } from '../components/approval';
export function ExportsPage({ workspace }: { workspace: Workspace | null }) {
  const [showExample, setShowExample] = useState(false);
  const [print, setPrint] = useState(false);
  return (
    <div className="exports-page">
      <div className="section-intro">
        <div>
          <h2>A review trail. Not a write-back.</h2>
          <p>
            Evidence can be downloaded freely. Accounting imports need a fully supported, explicitly
            approved proposal.
          </p>
        </div>
      </div>
      <Notice>
        <strong>Beta formats, not tested in your QuickBooks account.</strong> Export does not post
        an entry. Test in a backup or sample company, then re-import the GL to verify. Never retry a
        whole partially successful import.
      </Notice>
      <section className="export-section panel">
        <div className="export-section-heading">
          <FileText size={24} />
          <div>
            <h3>Current reconciliation workpapers</h3>
            <p>
              {workspace
                ? `${workspace.files.length} source files · ${workspace.result.groups.length} reconciliation groups · ${workspace.isDemo ? 'Synthetic data only' : 'Local file activity'}`
                : 'Load a sample month or reconcile your files to prepare workpapers.'}
            </p>
          </div>
        </div>
        <div className="export-options">
          <button disabled={!workspace} onClick={() => workspace && downloadEvidence(workspace)}>
            <span>
              <strong>Matching evidence</strong>
              <small>JSON · Source hashes, groups, controls & rules</small>
            </span>
            <Download size={18} />
          </button>
          <button
            disabled={!workspace}
            onClick={() =>
              workspace &&
              downloadText(
                `exception-register-${workspace.runId}.csv`,
                evidenceCsv(workspace.result),
                'text/csv;charset=utf-8',
              )
            }
          >
            <span>
              <strong>Exception register</strong>
              <small>CSV · Formula-safe, for human review</small>
            </span>
            <Download size={18} />
          </button>
          <button
            disabled={!workspace}
            onClick={() => {
              setPrint(true);
              setTimeout(() => window.print(), 100);
            }}
          >
            <span>
              <strong>Evidence summary</strong>
              <small>Print / Save as PDF · Review packet</small>
            </span>
            <Printer size={18} />
          </button>
        </div>
        <div className="export-blocked">
          <LockKeyhole size={18} />
          <div>
            <strong>Accounting imports require case-level review</strong>
            <p>
              Open an actual case in the reconciliation desk to review its facts and build an
              eligible fee-only proposal. Sample fee math is not approval. Actual bank posting,
              expense coverage, account types, and duplicate-entry checks must all be evidenced.
              Undeposited Funds requires its payment-to-deposit workflow, not a generic clearing
              journal.
            </p>
          </div>
        </div>
      </section>
      <section className="teaching-intro panel">
        <div>
          <Status tone="blue">Independent synthetic example</Status>
          <h3>Why only the missing $900?</h3>
          <p>
            A $10,000 gross receipt and a $9,100 posted bank deposit leave a $900 clearing residual.
            In this separate fictional case, the settlement statement proves the fee and the full
            ledger proves it is not already recorded.
          </p>
          <p className="body-muted">
            This teaching case is not a result from the sample month. It assumes verified existing
            accounts, complete posted journals, an open period, and a completed expense review.
          </p>
        </div>
        <button className="button button-secondary" onClick={() => setShowExample(!showExample)}>
          {showExample ? 'Hide teaching case' : 'Review the $900 example'}
          <ArrowRight size={16} />
        </button>
      </section>
      {showExample && <TeachingCase />}
      {workspace && print && <PrintSummary workspace={workspace} />}
    </div>
  );
}
export function TeachingCase() {
  const [proposal, setProposal] = useState<FeeProposal | null>(null);
  const [reviewer, setReviewer] = useState('');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState('2026-09-30');
  const [exported, setExported] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current++;
    };
  }, []);
  useEffect(() => {
    const current = ++revision.current;
    setProposal(null);
    setAttest(false);
    setExported(false);
    setError('');
    const c = createTeachingFeeCase();
    c.journalDate = date;
    buildFeeProposal(c)
      .then((p) => {
        if (mounted.current && current === revision.current) setProposal(p);
      })
      .catch((e) => {
        if (mounted.current && current === revision.current) setError(e.message);
      });
    return () => {
      if (current === revision.current) revision.current++;
    };
  }, [date, reviewer]);
  function invalidateView() {
    revision.current++;
    setProposal(null);
    setAttest(false);
    setExported(false);
    setBusy(false);
    setError('');
  }
  async function approve() {
    if (
      !proposal ||
      !attest ||
      proposal.state !== 'DRAFT' ||
      proposal.date !== date ||
      proposal.feeCase.journalDate !== date
    )
      return;
    const current = revision.current;
    const snapshot = proposal;
    const approvedReviewer = reviewer.trim();
    setBusy(true);
    setError('');
    try {
      const approved = await approveProposal(snapshot, approvedReviewer);
      if (mounted.current && current === revision.current) setProposal(approved);
    } catch (e) {
      if (mounted.current && current === revision.current)
        setError(e instanceof Error ? e.message : 'Approval failed.');
    } finally {
      if (mounted.current && current === revision.current) setBusy(false);
    }
  }
  async function exportFile(format: 'qbo' | 'qbd') {
    if (!approvalMatchesView(proposal, date, reviewer) || !attest) {
      setError(
        'The visible date or reviewer no longer matches the approval. Review and approve again.',
      );
      return;
    }
    const current = revision.current;
    const snapshot = proposal;
    setBusy(true);
    setError('');
    try {
      const artifact = await (format === 'qbo' ? exportQboCsv(snapshot) : exportQbdIif(snapshot));
      if (!mounted.current || current !== revision.current) return;
      downloadText(artifact.fileName, artifact.content, artifact.mimeType);
      downloadText(
        `${artifact.fileName}.manifest.json`,
        JSON.stringify(artifact.manifest, null, 2),
        'application/json',
      );
      setExported(true);
    } catch (e) {
      if (mounted.current && current === revision.current)
        setError(e instanceof Error ? e.message : 'Export blocked.');
    } finally {
      if (mounted.current && current === revision.current) setBusy(false);
    }
  }
  return (
    <section className="teaching-case panel">
      <div className="export-section-heading">
        <FileCheck2 size={24} />
        <div>
          <h3>Synthetic fee-only proposal</h3>
          <p>$10,000.00 gross − $9,100.00 already posted to bank = $900.00 documented fee</p>
        </div>
        <Status tone={proposal?.state === 'APPROVED' ? 'green' : 'amber'}>
          {exported
            ? 'Exported, not posted'
            : proposal?.state === 'APPROVED'
              ? 'Synthetic proposal approved'
              : 'Draft for review'}
        </Status>
      </div>
      <div className="ledger-comparison">
        <div>
          <h4>Already in the fictional ledger</h4>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Debit</th>
                <th>Credit</th>
              </tr>
            </thead>
            <tbody>
              {createTeachingFeeCase().postedGL.map((line, i) => (
                <tr key={i}>
                  <td>
                    {createTeachingFeeCase().accounts.find((a) => a.id === line.accountId)?.name}
                  </td>
                  <td>{line.debitCents ? money(line.debitCents) : '—'}</td>
                  <td>{line.creditCents ? money(line.creditCents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h4>Proposed missing-fee adjustment</h4>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Debit</th>
                <th>Credit</th>
              </tr>
            </thead>
            <tbody>
              {proposal?.lines.map((line, i) => (
                <tr key={i}>
                  <td>{line.account}</td>
                  <td>{line.debitCents ? money(line.debitCents) : '—'}</td>
                  <td>{line.creditCents ? money(line.creditCents) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="after-residual">
            <Check size={15} />
            Expected component residual: $0.00. No second bank deposit.
          </p>
        </div>
      </div>
      <div className="proposal-review">
        <label>
          Journal date
          <input
            type="date"
            value={date}
            min="2026-09-01"
            max="2026-09-30"
            disabled={busy}
            onChange={(e) => {
              invalidateView();
              setDate(e.target.value);
            }}
          />
        </label>
        <label>
          Reviewer name
          <input
            value={reviewer}
            disabled={busy}
            onChange={(e) => {
              invalidateView();
              setReviewer(e.target.value);
            }}
            placeholder="Enter your name for this example"
          />
        </label>
        <div>
          <strong>Approval binds the exact proposal</strong>
          <p>
            Changing its date, accounts, amounts, source evidence, or rules requires a fresh review.
            Hashes detect changes; they do not authenticate the reviewer.
          </p>
        </div>
      </div>
      <label className="checkbox-line">
        <input
          type="checkbox"
          checked={attest}
          disabled={proposal?.state === 'APPROVED' || busy}
          onChange={(e) => setAttest(e.target.checked)}
        />
        <span>
          I reviewed the separate synthetic evidence and approve only the displayed $900 fee debit /
          clearing credit for this fictional case. This does not approve any entry in a real
          company.
        </span>
      </label>
      {error && <Notice error>{error}</Notice>}
      <div className="button-row">
        <button
          className="button button-primary"
          onClick={approve}
          disabled={
            !proposal ||
            proposal.state === 'APPROVED' ||
            !attest ||
            reviewer.trim().length < 2 ||
            busy
          }
        >
          {busy ? (
            <Spinner label="Checking proposal" />
          ) : proposal?.state === 'APPROVED' ? (
            <>
              <Check size={16} />
              Approved for this example
            </>
          ) : (
            <>Approve synthetic proposal</>
          )}
        </button>
        <button
          className="button button-secondary"
          onClick={() => exportFile('qbo')}
          disabled={!approvalMatchesView(proposal, date, reviewer) || !attest || busy}
        >
          <Download size={16} />
          QBO CSV · Beta
        </button>
        <button
          className="button button-secondary"
          onClick={() => exportFile('qbd')}
          disabled={!approvalMatchesView(proposal, date, reviewer) || !attest || busy}
        >
          <Download size={16} />
          QBD IIF · Beta
        </button>
      </div>
      {exported && (
        <Notice>
          The synthetic file and its approval manifest were downloaded. Nothing was posted.
          Re-imported target GL evidence is still required for verification.
        </Notice>
      )}
      {proposal?.approval && (
        <p className="approval-hash">Proposal hash: {proposal.approval.payloadHash}</p>
      )}
    </section>
  );
}
function PrintSummary({ workspace }: { workspace: Workspace }) {
  return (
    <article className="print-summary">
      <h1>Reconciliation evidence summary</h1>
      <p>
        {workspace.isDemo
          ? 'Synthetic demonstration. No customer data.'
          : 'Local file reconciliation. Review only.'}
      </p>
      <p>
        Run {workspace.runId} · {workspace.options.periodStart} to {workspace.options.periodEnd} ·
        As of {workspace.options.asOfDate}
      </p>
      <p>Export is not posting. Missing records do not establish a cause or platform defect.</p>
      <h2>Source controls</h2>
      <p>
        ST gross receipts: {money(workspace.result.controls.st_gross_cents)} · Bank signed activity:{' '}
        {money(workspace.result.controls.bank_signed_cents)}
      </p>
      <h2>Largest review items</h2>
      <table>
        <thead>
          <tr>
            <th>Impact</th>
            <th>State</th>
            <th>Cause / evidence</th>
            <th>Unexplained</th>
          </tr>
        </thead>
        <tbody>
          {[...workspace.result.groups]
            .sort((a, b) => b.impact_cents - a.impact_cents)
            .slice(0, 30)
            .map((g) => (
              <tr key={g.id}>
                <td>{money(g.impact_cents)}</td>
                <td>{humanize(g.matching_state)}</td>
                <td>
                  {g.diagnoses
                    .map((d) => `${humanize(d.cause)} (${humanize(d.evidence_level)})`)
                    .join('; ') || 'No confirmed cause'}
                </td>
                <td>{money(g.unexplained_cents)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <h2>Source manifest</h2>
      {workspace.files.map((f) => (
        <p key={f.hash}>
          {f.name} · SHA-256 {f.hash}
        </p>
      ))}
    </article>
  );
}
