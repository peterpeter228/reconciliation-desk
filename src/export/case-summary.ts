import type { EngineGroup } from '../contracts/engine';
import type { Workspace } from '../components/workspace';
import type { ReviewCase } from '../review/types';
import type { CaseFacts } from '../review/case-adapter';
import { formatCents } from '../ingestion/primitives';

/**
 * Recipient-readable case summary. Static HTML with every value escaped and a
 * no-script CSP; it is a human review document, never an accounting import.
 */
const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const usd = (cents: number) => `${formatCents(cents)} USD`;
const list = (items: string[], empty: string) =>
  items.length
    ? `<ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
    : `<p class="muted">${escapeHtml(empty)}</p>`;
const rows = (pairs: [string, string][]) =>
  `<table>${pairs.map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`;
/** Engine codes such as QB_ACTUAL_BANK_POSTING read as plain words. */
const plainCode = (code: string) =>
  /^[A-Z0-9_]+$/.test(code)
    ? code
        .toLowerCase()
        .replaceAll('_', ' ')
        .replace(/^./, (c) => c.toUpperCase())
    : code;
const yesNo = (v: boolean) => (v ? 'Yes (reviewer statement)' : 'No / not stated');

export interface CaseSummaryInput {
  workspace: Workspace;
  group: EngineGroup;
  review: ReviewCase;
  facts: CaseFacts;
  /** Current accounting-draft blocker from the actual builder, or null when gates pass. */
  accountingBlocker: string | null;
  generatedAt?: string;
}

export function caseSummaryHtml({
  workspace: w,
  group: g,
  review: r,
  facts: f,
  accountingBlocker,
  generatedAt = new Date().toISOString(),
}: CaseSummaryInput): string {
  const verified = new Set(w.restoredSources?.verifiedHashes ?? []);
  const sources = w.files.map((file) => {
    const manifest = w.input.manifests.find((m) => m.source_file_sha256 === file.hash);
    const binding = !w.restoredSources
      ? 'Parsed from original bytes in this session'
      : verified.has(file.hash)
        ? 'Re-verified against original bytes'
        : 'NOT re-verified since reopening';
    return `<tr><td>${escapeHtml(file.name)}</td><td>${escapeHtml(file.kind)}</td><td>${escapeHtml(
      manifest ? `${manifest.period_start} – ${manifest.period_end}` : 'unknown',
    )}</td><td>${escapeHtml(manifest?.normalized_row_count ?? 'unknown')}</td><td>${escapeHtml(
      file.importStatus ?? 'not recorded',
    )}</td><td>${escapeHtml(binding)}</td><td class="hash">${escapeHtml(file.hash.slice(0, 12))}…</td></tr>`;
  });
  const observations = g.diagnoses.map(
    (d) => `${d.cause}: ${d.evidence_level} (evidence score ${d.score}/100, not a probability)`,
  );
  const missing = [...new Set(g.diagnoses.flatMap((d) => d.missing_evidence))].map(plainCode);
  const fullHashes = w.files.map((file) => `${file.name}: ${file.hash}`);
  const docs = f.documents.map((d) => `${d.purpose}: ${d.name} · SHA-256 ${d.sha256}`);
  const history = r.exportHistory.map(
    (h) => `${h.journalId} · ${h.format.toUpperCase()} · recorded ${h.exportedAt} · ${h.status}`,
  );
  const lines = r.proposal?.lines.map(
    (l) => `${l.account}: debit ${usd(l.debitCents)}, credit ${usd(l.creditCents)}`,
  );
  const next = r.exportHistory.length
    ? `An accounting file was already recorded for this case (${r.exportHistory
        .map((h) => h.journalId)
        .join(
          ', ',
        )}). Search the books for that journal number and re-export the GL before any further entry. Do not create a second journal.`
    : accountingBlocker
      ? `Accounting draft blocked: ${accountingBlocker}`
      : 'Every documented gate currently passes. A reviewer must still build, inspect and explicitly approve the exact two lines before any download.';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Case review summary ${escapeHtml(r.economicCaseId)}</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1d2330;background:#fff;margin:0 auto;max-width:960px;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #d9dde5;padding-bottom:4px}
.banner{border:2px solid #9a5b00;background:#fff7e6;padding:10px 12px;margin:12px 0;border-radius:6px}
.muted{color:#5b6475}table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #d9dde5;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f4f6f9;font-weight:600;width:34%}.hash{font:12px ui-monospace,monospace;word-break:break-all}
.wrap{overflow-x:auto}@media print{.banner{border-color:#000;background:#fff}}
</style></head><body>
<h1>Case review summary</h1>
<p class="muted">Case ${escapeHtml(r.economicCaseId)} · generated ${escapeHtml(generatedAt)}</p>
<div class="banner"><strong>${w.isDemo ? 'SYNTHETIC SAMPLE — NOT CUSTOMER DATA. ' : ''}Human review summary.</strong> Not an accounting import, not proof of posting, and not a recovered-funds claim. Reviewer statements below are recorded as stated; this tool does not authenticate documents or reviewers.</div>
<p><strong>Contains financial information, company labels and reviewer statements.</strong> Store securely and share only with authorized recipients.</p>
<h2>Scope</h2>
${rows([
  ['Company label', w.options.companyId],
  ['Bank label', w.options.bankAccountId],
  ['Period', `${w.options.periodStart} – ${w.options.periodEnd} (as of ${w.options.asOfDate})`],
  ['Case status', `${g.matching_state} / ${g.matching_scope} / search ${g.search_status}`],
  ['Identity', `${r.identityStatus} · prior import ${r.existingImportStatus}`],
  ['Rule versions', `${w.result.versions.engine} · ${w.result.versions.rules}`],
])}
<h2>Sources used</h2>
<div class="wrap"><table><tr><th>File</th><th>Kind</th><th>Period</th><th>Rows</th><th>Import</th><th>Byte binding</th><th>SHA-256</th></tr>${sources.join('')}</table></div>
<p><strong>Full SHA-256 of each original file</strong> (compare with your retained exports):</p>
<div class="hash">${list(fullHashes, '')}</div>
<h2>Amounts (from source rows)</h2>
${rows([
  ['Gross receipts', usd(g.gross_cents)],
  ['Refunds', usd(g.refunds_cents)],
  ['Fees (engine-assessed)', usd(g.fees_cents)],
  ['Holds', usd(g.holds_cents)],
  ['External receipts', usd(g.external_receipts_cents)],
  ['Bank deposits', usd(g.bank_cents)],
  ['Unexplained', usd(g.unexplained_cents)],
])}
<h2>What the evidence shows</h2>
${list(observations, 'No diagnosis recorded.')}
<h2>Not yet verified</h2>
${list(missing, 'No missing evidence listed by the engine. Reviewer statements are still not independent proof.')}
<h2>Reviewer statements</h2>
${rows([
  ['Reviewer', f.reviewer || 'not recorded'],
  ['Basis / open questions', f.notes || 'not recorded'],
  ['Documented fee', f.documentedFee ? `${f.documentedFee} USD (${f.feeMode})` : 'not recorded'],
  ['Net fee confirmed from settlement evidence', yesNo(f.netFeeConfirmed)],
  ['Fee not already recorded', yesNo(f.expenseNotRecordedConfirmed)],
  ['Complete GL for bank, clearing and fee accounts', yesNo(f.completeLedgerConfirmed)],
  ['Clearing is an ordinary asset (not UF / liability)', yesNo(f.clearingIsOrdinaryAsset)],
  ['Accounting period open', yesNo(f.periodOpenConfirmed)],
])}
<p><strong>Supporting documents (hash only):</strong></p>
${list(docs, 'No supporting documents attached.')}
<h2>Accounting output</h2>
${lines ? `<p>Proposal ${escapeHtml(r.proposal!.journalId)} · ${escapeHtml(r.proposal!.state)}</p>${list(lines, '')}` : '<p class="muted">No accounting draft.</p>'}
<p><strong>Recorded exports:</strong></p>
${list(history, 'None recorded in this project.')}
<h2>Next step and who confirms</h2>
<p>${escapeHtml(next)}</p>
<p class="muted">A qualified reviewer for this company confirms account types, the fee amount, ledger completeness and period status in the actual books. Only the original exports, not this summary, are source evidence.</p>
</body></html>
`;
}
