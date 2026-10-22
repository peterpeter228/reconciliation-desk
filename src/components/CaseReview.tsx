import { useEffect, useRef, useState } from 'react';
import type { Workspace } from './workspace';
import { downloadText, money } from './workspace';
import type { EngineGroup } from '../contracts/engine';
import type { ReviewCase } from '../review/types';
import { reviewForGroup } from '../review/project';
import {
  initialFacts,
  proposalFromCase,
  ufReviewConflicts,
  type CaseFacts,
  type ReviewDocument,
} from '../review/case-adapter';
import {
  companyKey,
  readExportRegister,
  registeredExportsFor,
  releaseExport,
  reserveExport,
} from '../review/export-register';
import { caseSummaryHtml } from '../export/case-summary';
import { sha256, parseMoney, canonicalJson } from '../ingestion/primitives';
import { approveProposal } from '../export/aje';
import { exportQboCsv } from '../export/qbo';
import { buildUfWorksheet, type UfPayment } from '../export/evidence';
import { Notice } from './ui';
import { associateEvidenceBatch } from '../review/evidence-batch';

/** Readable validation errors: never show raw schema JSON to a reviewer. */
export function reviewErrorMessage(e: unknown): string {
  const issues = (e as { issues?: { path?: (string | number)[]; message?: string }[] })?.issues;
  if (Array.isArray(issues) && issues.length)
    return `Review data is incomplete or invalid: ${issues
      .slice(0, 3)
      .map((i) => `${(i.path ?? []).join('.') || 'value'} (${i.message ?? 'invalid'})`)
      .join('; ')}.`;
  return e instanceof Error ? e.message : String(e);
}

export function CaseReview({
  workspace: w,
  group: g,
  onChange,
}: {
  workspace: Workspace;
  group: EngineGroup;
  onChange: (w: Workspace) => void;
}) {
  const r = w.review && reviewForGroup(w.review, g.id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [purpose, setPurpose] = useState<ReviewDocument['purpose']>('SETTLEMENT');
  const [approved, setApproved] = useState(false);
  const [registerWarning, setRegisterWarning] = useState('');
  const [batchHash, setBatchHash] = useState('');
  const [batchCase, setBatchCase] = useState('');
  const [batchIds, setBatchIds] = useState('');
  const latest = useRef(w);
  latest.current = w;
  useEffect(() => {
    setApproved(false);
  }, [w]);
  const operation = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!r)
    return (
      <Notice>
        Case review identity is not initialized. Save and reopen the project before accounting
        review.
      </Notice>
    );
  const f = { ...initialFacts(w), ...(r.reviewedFacts as Partial<CaseFacts>) };
  // Exports recorded by this browser but missing from this project copy (older save, other tab).
  const browserExports = () =>
    w.isDemo
      ? []
      : registeredExportsFor(readExportRegister(), w.options.companyId, r).filter(
          (e) => !r.exportHistory.some((h) => h.journalId === e.journalId),
        );
  const unseenExports = browserExports();
  const priorJournals = [
    ...new Set([...r.exportHistory, ...unseenExports].map((x) => x.journalId)),
  ];
  const blockIfExportedHere = () => {
    const seen = browserExports();
    if (seen.length)
      throw new Error(
        `Journal ${seen.map((e) => e.journalId).join(', ')} was already exported for this case in this browser (${seen
          .map((e) => e.exportedAt)
          .join(
            ', ',
          )}). This project copy does not show it. Check the books for that journal number; do not create a second journal.`,
      );
  };
  function update(patch: Partial<CaseFacts>) {
    const next = structuredClone(w);
    const c = reviewForGroup(next.review!, g.id)!;
    c.reviewedFacts = { ...f, ...patch };
    delete c.proposal;
    setApproved(false);
    setError('');
    onChange(next);
  }
  async function upload(file: File) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Supporting document exceeds 10 MB.');
      const d = {
        name: file.name,
        sha256: await sha256(new Uint8Array(await file.arrayBuffer())),
        purpose,
        sizeBytes: file.size,
      };
      if (!mounted.current || latest.current !== w)
        throw new Error('Review changed during document reading. Select the file again.');
      update({ documents: [...f.documents.filter((x) => x.purpose !== purpose), d] });
    } catch (e) {
      setError(String(e));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function build() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      blockIfExportedHere();
      const proposal = await proposalFromCase(w, g, r!, f);
      if (!mounted.current || latest.current !== w)
        throw new Error('Source or review changed; rebuild the draft.');
      const next = structuredClone(w);
      reviewForGroup(next.review!, g.id)!.proposal = proposal;
      onChange(next);
      setApproved(false);
    } catch (e) {
      setError(reviewErrorMessage(e));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function approve() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      if (!r!.proposal || !approved)
        throw new Error('Review the exact two journal lines and explicitly approve.');
      blockIfExportedHere();
      // Rebuild from current source and facts before approving, not from stale form state.
      const current = await proposalFromCase(w, g, r!, f);
      const p = await approveProposal(current, f.reviewer);
      if (!mounted.current || latest.current !== w)
        throw new Error('Source or review changed; approve the new draft.');
      const next = structuredClone(w);
      reviewForGroup(next.review!, g.id)!.proposal = p;
      onChange(next);
    } catch (e) {
      setError(reviewErrorMessage(e));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function exportJournal() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      if (!r!.proposal || r!.exportHistory.length)
        throw new Error(
          'Prior download/import outcome must be reviewed before any new accounting artifact.',
        );
      blockIfExportedHere();
      const rebuilt = await proposalFromCase(w, g, r!, f);
      if (canonicalJson(rebuilt.feeCase) !== canonicalJson(r!.proposal.feeCase))
        throw new Error('Current facts differ from the approved payload. Rebuild and reapprove.');
      const artifact = await exportQboCsv(r!.proposal);
      if (!mounted.current || latest.current !== w)
        throw new Error('Source or review changed during export. No file downloaded.');
      const next = structuredClone(w);
      const c = reviewForGroup(next.review!, g.id)!;
      const exportedAt = new Date().toISOString();
      // Reserve in this browser before any download: one check-and-record step that a
      // second tab or an older project copy cannot pass for the same case.
      const entry = {
        companyKey: companyKey(w.options.companyId),
        economicCaseId: c.economicCaseId,
        accountingActionId: c.accountingActionId,
        journalId: artifact.manifest.journalId,
        proposalId: artifact.manifest.proposalId,
        proposalHash: artifact.manifest.proposalHash,
        exportedAt,
        format: 'csv' as const,
      };
      const reservation = w.isDemo
        ? { reserved: true, existing: [], persisted: true }
        : await reserveExport(entry, w.options.companyId, c);
      if (!reservation.reserved) blockIfExportedHere();
      if (!reservation.reserved)
        throw new Error('This case was already exported in this browser. No file downloaded.');
      // The lock wait is asynchronous: the case may have been closed or changed meanwhile.
      // Nothing was downloaded, so the reservation is released rather than left as a
      // false "already exported" record.
      if (!mounted.current || latest.current !== w) {
        if (!w.isDemo) await releaseExport(entry);
        throw new Error('Source or review changed during export. No file downloaded.');
      }
      // Record the attempt before browser download; ambiguous download never resets to new.
      c.exportHistory.push({
        journalId: artifact.manifest.journalId,
        proposalId: artifact.manifest.proposalId,
        proposalHash: artifact.manifest.proposalHash,
        exportedAt,
        status: 'EXPORTED_NOT_POSTED',
        format: 'csv',
      });
      c.existingImportStatus = 'UNKNOWN';
      setRegisterWarning(
        reservation.persisted
          ? ''
          : 'This browser could not keep its local export record. Save the review project now; it is the only record of this export.',
      );
      onChange(next);
      downloadText(artifact.fileName, artifact.content, artifact.mimeType);
      downloadText(
        `${artifact.fileName}.manifest.json`,
        JSON.stringify(artifact.manifest, null, 2),
        'application/json',
      );
    } catch (e) {
      setError(reviewErrorMessage(e));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  const tx = [
    ...new Set(
      w.input.qb
        .filter((x) => g.qb_ids.includes(x.id))
        .flatMap((x) => (x.transaction_id ? [x.transaction_id] : [])),
    ),
  ];
  const accountNames = [...new Set(w.input.qb.map((x) => x.account_full_name))];
  const extraTx = [
    ...new Set(
      w.input.qb
        .filter(
          (x) =>
            x.role === 'FEE' ||
            [f.feeAccountName, f.clearingAccountName].includes(x.account_full_name),
        )
        .flatMap((x) =>
          x.transaction_id &&
          ![f.receiptTransactionId, f.settlementTransactionId].includes(x.transaction_id)
            ? [x.transaction_id]
            : [],
        ),
    ),
  ];
  const field = (label: string, key: keyof CaseFacts, type = 'text') => (
    <label>
      {label}
      <input
        type={type}
        value={String(f[key] ?? '')}
        onChange={(e) => update({ [key]: e.target.value })}
      />
    </label>
  );
  const check = (label: string, key: keyof CaseFacts) => (
    <label className="checkbox-line">
      <input
        type="checkbox"
        checked={f[key] === true}
        onChange={(e) => update({ [key]: e.target.checked })}
      />
      <span>{label}</span>
    </label>
  );
  function workpaper() {
    downloadText(
      `case-review-${r!.economicCaseId}.json`,
      JSON.stringify(
        {
          level: 'HUMAN_JUDGMENT_DRAFT_NOT_ACCOUNTING_IMPORT',
          caseId: r!.economicCaseId,
          group: g,
          facts: f,
          sourceFiles: w.files,
          missingEvidence: g.diagnoses.flatMap((d) => d.missing_evidence),
          proposal: r!.proposal ?? null,
          history: r!.exportHistory,
          scope:
            'Manual review statements and locally selected documents are not independently authenticated. No posting or recovery of funds is claimed.',
        },
        null,
        2,
      ),
      'application/json',
    );
  }
  async function summary() {
    let blocker: string | null = null;
    try {
      blockIfExportedHere();
      await proposalFromCase(w, g, r!, f);
    } catch (e) {
      blocker = reviewErrorMessage(e);
    }
    if (!mounted.current || latest.current !== w) return;
    downloadText(
      `case-summary-${r!.economicCaseId}.html`,
      caseSummaryHtml({ workspace: w, group: g, review: r!, facts: f, accountingBlocker: blocker }),
      'text/html;charset=utf-8',
    );
  }
  return (
    <section className="case-review panel" aria-label="Current case accounting review">
      <h3>Review this economic case</h3>
      <p className="body-muted">
        Investigation remains available even when an accounting import is blocked. Review statements
        are human judgments, not automatic source verification.
      </p>
      <p>
        <strong>Stable case:</strong> {r.economicCaseId} · {r.identityStatus} · Prior import:{' '}
        {r.existingImportStatus}
      </p>
      {priorJournals.length > 0 && (
        <Notice>
          <strong>Accounting file already recorded: {priorJournals.join(', ')}.</strong> A download
          is not proof of posting, and a failed download is not proof it was never imported. To
          resolve it: (1) in QuickBooks, search for journal number {priorJournals.join(', ')}; (2)
          re-export the GL or Transaction Journal for the period and review it; (3) if the entry is
          absent, prepare any correction manually under your own review. Further export is blocked
          while this case’s export history is available. Company-label changes, missing browser
          locks, cleared site data or other devices can bypass local duplicate protection; always
          check the actual books.
          {unseenExports.length > 0 &&
            ' This project copy does not include that export; it was recorded earlier in this browser.'}{' '}
          Save this review project now.
        </Notice>
      )}
      {registerWarning && <Notice error>{registerWarning}</Notice>}
      <div className="button-row">
        <button className="button button-secondary" onClick={() => void summary()}>
          Download reviewer summary (HTML)
        </button>
        <button className="button button-secondary" onClick={workpaper}>
          Download human-judgment workpaper (JSON)
        </button>
      </div>
      <small>
        Contains financial information, company labels and reviewer statements. Store securely and
        share only with authorized recipients.
      </small>
      <details>
        <summary>Review facts & documented fee-only proposal</summary>
        <fieldset disabled={busy} className="form-stack">
          {field('Reviewer', 'reviewer')}
          {field('Accounting basis / unresolved questions', 'notes')}
          {field('Journal date', 'journalDate', 'date')}
          <label>
            Document purpose
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as ReviewDocument['purpose'])}
            >
              <option value="SETTLEMENT">Settlement fee evidence</option>
              <option value="COA">Actual chart of accounts</option>
              <option value="LEDGER">Full GL coverage evidence</option>
            </select>
          </label>
          <label>
            Attach a locally reviewed supporting document
            <input
              type="file"
              onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
            />
          </label>
          <small>
            Only its name, byte digest and review purpose are saved; the document is not sent
            anywhere or automatically interpreted. Keep the original with your review project.
          </small>
          <ul>
            {f.documents.map((d) => (
              <li key={d.purpose}>
                {d.purpose}: {d.name} · {d.sha256.slice(0, 12)}
              </li>
            ))}
          </ul>
          <label>
            Exact accounts covered by reviewed full GL (one full name per line, including
            zero-activity fee account)
            <textarea
              value={f.ledgerCoveredAccountNames}
              onChange={(e) => update({ ledgerCoveredAccountNames: e.target.value })}
            />
          </label>
          <label>
            Reviewed GL coverage starts
            <input
              type="date"
              value={f.ledgerPeriodStart}
              onChange={(e) => update({ ledgerPeriodStart: e.target.value })}
            />
          </label>
          <label>
            Reviewed GL coverage ends
            <input
              type="date"
              value={f.ledgerPeriodEnd}
              onChange={(e) => update({ ledgerPeriodEnd: e.target.value })}
            />
          </label>
          <datalist id="review-account-names">
            {accountNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {(['bankAccountName', 'clearingAccountName', 'feeAccountName'] as const).map((key, i) => (
            <label key={key}>
              {
                [
                  'Existing bank account full name',
                  'Existing ordinary asset clearing full name',
                  'Existing fee expense account full name',
                ][i]
              }
              <input
                list="review-account-names"
                value={f[key]}
                onChange={(e) => update({ [key]: e.target.value })}
              />
            </label>
          ))}
          <fieldset>
            <legend>Actual chart of accounts review</legend>
            <small>
              Explicitly confirm each account against the attached COA. A chosen label never creates
              or changes an account.
            </small>
            {[
              ...new Set(
                [
                  ...accountNames,
                  f.bankAccountName,
                  f.clearingAccountName,
                  f.feeAccountName,
                ].filter(Boolean),
              ),
            ].map((name) => {
              const a = f.reviewedAccounts.find((a) => a.name === name) ?? {
                id: name,
                name,
                type: 'UNKNOWN' as const,
                exists: false,
                isUndepositedFunds: null,
              };
              const patch = (p: Partial<typeof a>) =>
                update({
                  reviewedAccounts: [
                    ...f.reviewedAccounts.filter((x) => x.name !== name),
                    { ...a, ...p },
                  ],
                });
              return (
                <div key={name}>
                  <strong>{name}</strong>
                  <select
                    aria-label={`COA type ${name}`}
                    value={a.type}
                    onChange={(e) => patch({ type: e.target.value as typeof a.type })}
                  >
                    {[
                      'UNKNOWN',
                      'BANK',
                      'OTHER_CURRENT_ASSET',
                      'EXPENSE',
                      'OTHER_CURRENT_LIABILITY',
                      'OTHER',
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <label>
                    <input
                      type="checkbox"
                      checked={a.exists}
                      onChange={(e) => patch({ exists: e.target.checked })}
                    />
                    Exists in reviewed COA
                  </label>
                  <select
                    aria-label={`UF status ${name}`}
                    value={
                      a.isUndepositedFunds === null
                        ? 'UNKNOWN'
                        : a.isUndepositedFunds
                          ? 'UF'
                          : 'NOT_UF'
                    }
                    onChange={(e) =>
                      patch({
                        isUndepositedFunds:
                          e.target.value === 'UNKNOWN' ? null : e.target.value === 'UF',
                      })
                    }
                  >
                    <option>UNKNOWN</option>
                    <option>UF</option>
                    <option>NOT_UF</option>
                  </select>
                </div>
              );
            })}
          </fieldset>
          {(['receiptTransactionId', 'settlementTransactionId'] as const).map((key, i) => (
            <label key={key}>
              {i ? 'Posted net-bank settlement transaction' : 'Posted gross-receipt transaction'}
              <select value={f[key]} onChange={(e) => update({ [key]: e.target.value })}>
                <option value="">Choose a current-case QB transaction</option>
                {tx.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {field('Documented net fee in USD (not an inferred difference)', 'documentedFee')}
          <label>
            Fee mode
            <select
              value={f.feeMode}
              onChange={(e) => update({ feeMode: e.target.value as CaseFacts['feeMode'] })}
            >
              {['UNKNOWN', 'NETTED', 'SEPARATE_INVOICE', 'GROSS_SETTLED'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {check(
            'I reviewed the actual COA; all named GL accounts exist and their imported types are correct.',
            'accountsReviewed',
          )}
          {check(
            'Selected clearing is ordinary asset clearing, not Undeposited Funds or a liability.',
            'clearingIsOrdinaryAsset',
          )}
          {check(
            'The supplied GL includes complete relevant bank, clearing and fee activity for this period.',
            'completeLedgerConfirmed',
          )}
          {check(
            'Source evidence identifies this entire amount as this case’s netted fee, not a reserve/hold.',
            'netFeeConfirmed',
          )}
          {check(
            'I checked all fee journals and confirmed this fee has not already been recorded.',
            'expenseNotRecordedConfirmed',
          )}
          {check(
            'The selected accounting period is open and the journal date is appropriate.',
            'periodOpenConfirmed',
          )}
          {extraTx.length > 0 && (
            <fieldset>
              <legend>Other fee / clearing transactions in the full ledger</legend>
              <small>
                Do not discard these rows. Unknown relation blocks an accounting import; documented
                other-case activity does not.
              </small>
              <details>
                <summary>Associate an explicit transaction list by evidence</summary>
                <p>
                  Review the document and each transaction first. No amounts are inferred and no
                  rows are removed. All accounting gates still apply.
                </p>
                <label>
                  Batch evidence document / source SHA-256
                  <select
                    aria-label="Batch evidence"
                    value={batchHash}
                    onChange={(e) => setBatchHash(e.target.value)}
                  >
                    <option value="">Choose known evidence</option>
                    {[
                      ...new Map([
                        ...w.files.map((x) => [x.hash, x.name] as const),
                        ...f.documents.map((x) => [x.sha256, x.name] as const),
                      ]).entries(),
                    ].map(([hash, name]) => (
                      <option key={hash} value={hash}>
                        {name} · {hash}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Different bound economic case
                  <select
                    aria-label="Batch other case"
                    value={batchCase}
                    onChange={(e) => setBatchCase(e.target.value)}
                  >
                    <option value="">Choose reviewed other case</option>
                    {w.review?.cases
                      .filter(
                        (x) =>
                          x.economicCaseId !== r.economicCaseId && x.identityStatus === 'BOUND',
                      )
                      .map((x) => (
                        <option key={x.economicCaseId} value={x.economicCaseId}>
                          {x.economicCaseId}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Explicit transaction IDs, one per line (no automatic selection)
                  <textarea
                    aria-label="Batch transaction IDs"
                    value={batchIds}
                    onChange={(e) => setBatchIds(e.target.value)}
                  />
                </label>
                <p>
                  {batchIds.split(/\r?\n/).filter((x) => x.trim()).length} explicitly listed
                  transaction(s). Applying records your review, not independent verification.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const relations = associateEvidenceBatch(w, r, f, {
                        evidenceHash: batchHash,
                        relatedCaseId: batchCase,
                        transactionIds: batchIds
                          .split(/\r?\n/)
                          .map((x) => x.trim())
                          .filter(Boolean),
                        reviewer: f.reviewer,
                      });
                      update({ relations });
                      setBatchIds('');
                    } catch (e) {
                      setError(reviewErrorMessage(e));
                    }
                  }}
                >
                  Apply reviewed OTHER_CASE list
                </button>
              </details>
              {extraTx.map((id) => {
                const relation = f.relations.find((x) => x.transactionId === id);
                return (
                  <div key={id} className="form-stack">
                    <strong>{id}</strong>
                    <select
                      aria-label={`Relation for ${id}`}
                      value={relation?.relation ?? 'UNKNOWN'}
                      onChange={(e) =>
                        update({
                          relations: [
                            ...f.relations.filter((x) => x.transactionId !== id),
                            {
                              transactionId: id,
                              relation: e.target.value as 'THIS_CASE' | 'OTHER_CASE' | 'UNKNOWN',
                              relatedCaseId: relation?.relatedCaseId ?? null,
                              evidenceRef: relation?.evidenceRef ?? '',
                              reviewer: f.reviewer,
                            },
                          ],
                        })
                      }
                    >
                      <option>UNKNOWN</option>
                      <option>THIS_CASE</option>
                      <option>OTHER_CASE</option>
                    </select>
                    <input
                      aria-label={`Other case ID for ${id}`}
                      placeholder="Other economic case ID"
                      value={relation?.relatedCaseId ?? ''}
                      onChange={(e) =>
                        update({
                          relations: [
                            ...f.relations.filter((x) => x.transactionId !== id),
                            {
                              transactionId: id,
                              relation: relation?.relation ?? 'UNKNOWN',
                              relatedCaseId: e.target.value || null,
                              evidenceRef: relation?.evidenceRef ?? '',
                              reviewer: f.reviewer,
                            },
                          ],
                        })
                      }
                    />
                    <input
                      aria-label={`Association evidence for ${id}`}
                      placeholder="Document / row proving that association"
                      value={relation?.evidenceRef ?? ''}
                      onChange={(e) =>
                        update({
                          relations: [
                            ...f.relations.filter((x) => x.transactionId !== id),
                            {
                              transactionId: id,
                              relation: relation?.relation ?? 'UNKNOWN',
                              relatedCaseId: relation?.relatedCaseId ?? null,
                              evidenceRef: e.target.value,
                              reviewer: f.reviewer,
                            },
                          ],
                        })
                      }
                    />
                  </div>
                );
              })}
            </fieldset>
          )}
          <button className="button button-primary" disabled={busy} onClick={() => void build()}>
            Build supported fee-only draft
          </button>
          {r.proposal && (
            <div>
              <h4>
                {r.proposal.state} · {r.proposal.journalId}
              </h4>
              {r.proposal.lines.map((l, i) => (
                <p key={i}>
                  {l.account} · Debit {money(l.debitCents)} · Credit {money(l.creditCents)}
                </p>
              ))}
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                I reviewed these exact accounts, date, amounts and evidence. Download is not
                posting.
              </label>
              <button
                className="button button-primary button-small"
                disabled={busy || !approved || r.proposal.state === 'APPROVED'}
                onClick={() => void approve()}
              >
                Approve exact proposal
              </button>
              <button
                className="button button-secondary button-small"
                disabled={busy || r.proposal.state !== 'APPROVED' || priorJournals.length > 0}
                onClick={() => void exportJournal()}
              >
                Download approved QBO CSV
              </button>
            </div>
          )}
        </fieldset>
      </details>
      <UfReview workspace={w} group={g} review={r} facts={f} update={update} />
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}

function UfReview({
  workspace: w,
  group: g,
  review: r,
  facts: f,
  update,
}: {
  workspace: Workspace;
  group: EngineGroup;
  review: ReviewCase;
  facts: CaseFacts;
  update: (f: Partial<CaseFacts>) => void;
}) {
  const [error, setError] = useState('');
  const state = (f as CaseFacts & { ufPayments?: UfPayment[] }).ufPayments ?? [];
  const stIds = w.input.st
    .filter((x) => g.st_ids.includes(x.id))
    .flatMap((x) => (x.source_payment_id ? [x.source_payment_id] : []));
  function save(payments: UfPayment[]) {
    update({ ufPayments: payments } as Partial<CaseFacts>);
  }
  function exportUf() {
    try {
      const fee = f.documentedFee ? parseMoney(f.documentedFee)! : 0;
      const sheet = buildUfWorksheet({
        paymentIds: stIds,
        payments: state,
        bankAccount: f.bankAccountName,
        bankAccountVerified:
          f.accountsReviewed &&
          f.documents.some((x) => x.purpose === 'COA') &&
          f.reviewedAccounts.some(
            (a) => a.name === f.bankAccountName && a.exists && a.type === 'BANK',
          ),
        depositDate: f.journalDate,
        grossCents: g.gross_cents,
        feeCents: fee,
        bankNetCents: g.bank_cents,
        bankEvidenceRef: w.input.bank
          .filter((x) => g.bank_ids.includes(x.id))
          .flatMap((x) => x.source_refs.map((r) => `${r.file_sha256}:row${r.physical_row}`))
          .join(';'),
        feeAccount: f.feeAccountName,
        feeAccountVerified:
          f.accountsReviewed &&
          f.documents.some((x) => x.purpose === 'COA') &&
          f.reviewedAccounts.some(
            (a) => a.name === f.feeAccountName && a.exists && a.type === 'EXPENSE',
          ),
        feeEvidenceRef: f.documents.find((x) => x.purpose === 'SETTLEMENT')?.sha256 ?? '',
        feeNotRecordedConfirmed:
          f.expenseNotRecordedConfirmed &&
          f.completeLedgerConfirmed &&
          f.documents.some((d) => d.purpose === 'LEDGER') &&
          f.ledgerCoveredAccountNames
            .split(/\r?\n/)
            .map((x) => x.trim())
            .includes(f.feeAccountName) &&
          f.ledgerPeriodStart === w.options.periodStart &&
          f.ledgerPeriodEnd === w.options.periodEnd &&
          f.feeMode === 'NETTED' &&
          f.netFeeConfirmed &&
          !g.holds_cents &&
          !g.refunds_cents &&
          !g.releases_cents &&
          !g.external_receipts_cents,
        conflicts: ufReviewConflicts(w, g, r, { ...f, ufPayments: state }),
      });
      downloadText(`uf-worksheet-${g.id}.json`, JSON.stringify(sheet, null, 2), 'application/json');
      setError('');
    } catch (e) {
      setError(reviewErrorMessage(e));
    }
  }
  return (
    <details>
      <summary>UF candidate / reviewed deposit worksheet</summary>
      <p>
        ST IDs alone produce a candidate list. Supply the actual existing QB Payment IDs and
        reviewed undeposited status before giving selection instructions. Match an existing bank
        feed item; do not Categorize a second receipt.
      </p>
      {state.map((p, i) => (
        <div className="form-stack" key={i}>
          <input
            aria-label={`QB Payment ID ${i + 1}`}
            value={p.qbPaymentId}
            onChange={(e) =>
              save(state.map((x, j) => (j === i ? { ...x, qbPaymentId: e.target.value } : x)))
            }
          />
          <input
            key={`amount-${i}-${p.amountCents}`}
            aria-label={`Payment amount USD ${i + 1}`}
            inputMode="decimal"
            placeholder="e.g. 2,000.00"
            defaultValue={p.amountCents > 0 ? (p.amountCents / 100).toFixed(2) : ''}
            onBlur={(e) => {
              try {
                const cents = parseMoney(e.target.value);
                if (cents === null || cents <= 0) throw new Error('positive');
                setError('');
                save(state.map((x, j) => (j === i ? { ...x, amountCents: cents } : x)));
              } catch {
                setError(
                  `Payment ${i + 1}: enter the QuickBooks payment amount in USD, for example 2,000.00.`,
                );
              }
            }}
          />
          <input
            aria-label={`Payment status evidence ${i + 1}`}
            placeholder="QB payment / deposit report reference"
            value={p.statusEvidenceRef}
            onChange={(e) =>
              save(state.map((x, j) => (j === i ? { ...x, statusEvidenceRef: e.target.value } : x)))
            }
          />
          <input
            aria-label={`Existing deposit ID ${i + 1}`}
            placeholder="Existing deposit ID, if any"
            value={p.existingDepositId ?? ''}
            onChange={(e) =>
              save(
                state.map((x, j) =>
                  j === i ? { ...x, existingDepositId: e.target.value || null } : x,
                ),
              )
            }
          />
          <label>
            <input
              type="checkbox"
              checked={p.inUndepositedFunds === true && p.depositStatusReviewed}
              onChange={(e) =>
                save(
                  state.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          inUndepositedFunds: e.target.checked,
                          depositStatusReviewed: e.target.checked,
                        }
                      : x,
                  ),
                )
              }
            />
            Reviewed: still in UF, not already deposited
          </label>
        </div>
      ))}
      <button
        onClick={() =>
          save([
            ...state,
            {
              qbPaymentId: '',
              amountCents: 0,
              inUndepositedFunds: null,
              existingDepositId: null,
              depositStatusReviewed: false,
              statusEvidenceRef: '',
            },
          ])
        }
      >
        Add actual QB Payment
      </button>
      <button onClick={exportUf}>Download UF review worksheet</button>
      {error && <Notice error>{error}</Notice>}
    </details>
  );
}
