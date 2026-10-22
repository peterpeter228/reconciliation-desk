import type { Workspace } from '../components/workspace';
import type { EngineGroup } from '../contracts/engine';
import type { ReviewCase } from './types';
import {
  FEE_ONLY_RULE_VERSION,
  buildFeeProposal,
  type FeeCase,
  type VerifiedAccount,
} from '../export/aje';
import { checkedSum, parseMoney } from '../ingestion/primitives';
import { contentHash } from '../engine/identities';
import { sourceTrustBlocker } from './source-verification';

export interface ReviewDocument {
  name: string;
  sha256: string;
  purpose: 'SETTLEMENT' | 'COA' | 'LEDGER';
  sizeBytes: number;
}
export interface CaseFacts {
  reviewer: string;
  notes: string;
  journalDate: string;
  bankAccountName: string;
  clearingAccountName: string;
  feeAccountName: string;
  receiptTransactionId: string;
  settlementTransactionId: string;
  documentedFee: string;
  feeMode: 'NETTED' | 'SEPARATE_INVOICE' | 'GROSS_SETTLED' | 'UNKNOWN';
  netFeeConfirmed: boolean;
  periodOpenConfirmed: boolean;
  expenseNotRecordedConfirmed: boolean;
  completeLedgerConfirmed: boolean;
  ledgerCoveredAccountNames: string;
  ledgerPeriodStart: string;
  ledgerPeriodEnd: string;
  accountsReviewed: boolean;
  clearingIsOrdinaryAsset: boolean;
  documents: ReviewDocument[];
  reviewedAccounts: VerifiedAccount[];
  relations: NonNullable<FeeCase['postedGLRelations']>;
}
export function initialFacts(w: Workspace): CaseFacts {
  return {
    reviewer: '',
    notes: '',
    journalDate: w.options.periodEnd,
    bankAccountName: '',
    clearingAccountName: '',
    feeAccountName: '',
    receiptTransactionId: '',
    settlementTransactionId: '',
    documentedFee: '',
    feeMode: 'UNKNOWN',
    netFeeConfirmed: false,
    periodOpenConfirmed: false,
    expenseNotRecordedConfirmed: false,
    completeLedgerConfirmed: false,
    ledgerCoveredAccountNames: '',
    ledgerPeriodStart: '',
    ledgerPeriodEnd: '',
    accountsReviewed: false,
    clearingIsOrdinaryAsset: false,
    documents: [],
    reviewedAccounts: [],
    relations: [],
  };
}
export function documentRef(f: CaseFacts, purpose: ReviewDocument['purpose']): string {
  const d = f.documents.find((d) => d.purpose === purpose && /^[a-f0-9]{64}$/.test(d.sha256));
  if (!d)
    throw new Error(
      `Add a locally reviewed ${purpose.toLowerCase()} source document. An unsupported assertion remains a human-judgment workpaper.`,
    );
  return `${purpose}:${d.sha256}`;
}
export async function proposalFromCase(w: Workspace, g: EngineGroup, r: ReviewCase, f: CaseFacts) {
  const untrusted = sourceTrustBlocker(w);
  if (untrusted) throw new Error(untrusted);
  if (r.identityStatus !== 'BOUND')
    throw new Error(
      'Economic case identity is uncertain. Resolve prior activity before creating an import.',
    );
  if (r.exportHistory.length || r.existingImportStatus !== 'NEVER_IMPORTED')
    throw new Error(
      'This economic action has prior or uncertain import history. Re-import and review the ledger; do not create a second journal.',
    );
  if (!f.reviewer.trim() || !f.notes.trim())
    throw new Error('Record the reviewer and the case-specific accounting basis.');
  if (
    g.holds_cents ||
    g.refunds_cents ||
    g.releases_cents ||
    g.external_receipts_cents ||
    g.other_adjustments_cents
  )
    throw new Error(
      'Mixed holds, refunds or other adjustments require a manual review workpaper, not the fee-only template.',
    );
  if (
    !w.result.controls.conservation_ok ||
    !g.accepted ||
    g.search_status !== 'COMPLETE' ||
    ['AMBIGUOUS', 'BLOCKED', 'UNMATCHED'].includes(g.matching_state)
  )
    throw new Error(
      'This case has unresolved identity, allocation or search conflicts. Use a human-judgment workpaper.',
    );
  // The desk and the journal must tell the same story: a fee-only delta presumes the
  // net settlement is already posted to the bank in QuickBooks and linked to this deposit.
  const qbBank = g.edges.find((e) => e.kind === 'QB_BANK_SETTLEMENT');
  if (qbBank?.state !== 'CONFIRMED')
    throw new Error(
      `The QuickBooks → bank settlement link is ${qbBank ? qbBank.state.toLowerCase() : 'absent'}, not confirmed. Name the QuickBooks bank GL account on the import page and link the deposit (Linked Deposit ID), or keep this case as a workpaper.`,
    );
  if (
    w.files.some(
      (file) =>
        (file.kind === 'QBO' || file.kind === 'QBD') &&
        (file.importStatus === 'PARTIAL' ||
          file.importStatus === 'BLOCKED' ||
          (file.controls?.accountingBlockedTransactionIds?.length ?? 0) > 0),
    )
  )
    throw new Error(
      'Ledger import contains quarantined or conflicting control evidence. Investigation can continue; full accounting coverage must be restored before import.',
    );
  const q = w.input.qb;
  const relevantManifests = w.input.manifests.filter(
    (m) => m.source_system === 'QBO' || m.source_system === 'QBD',
  );
  if (
    !relevantManifests.length ||
    relevantManifests.some(
      (m) => m.qbo_transaction_journal || !m.coverage_confirmed || m.missing_required_fields.length,
    )
  )
    throw new Error(
      'Complete reviewed GL coverage is required. A single Transaction Journal report is not full-period coverage.',
    );
  if (!f.accountsReviewed || !f.clearingIsOrdinaryAsset)
    throw new Error(
      'Review the actual chart of accounts and confirm ordinary asset clearing, not UF or liability.',
    );
  const coaRef = documentRef(f, 'COA'),
    settlementRef = documentRef(f, 'SETTLEMENT'),
    ledgerRef = documentRef(f, 'LEDGER');
  const fee = parseMoney(f.documentedFee)!;
  const caseQb = q.filter((x) => g.qb_ids.includes(x.id));
  for (const tx of [f.receiptTransactionId, f.settlementTransactionId])
    if (!tx || !caseQb.some((x) => x.transaction_id === tx))
      throw new Error(
        'Choose existing posted receipt and settlement transactions linked to this current case. Equal amounts in another case are insufficient.',
      );
  const selected = [f.bankAccountName, f.clearingAccountName, f.feeAccountName];
  if (selected.some((x) => !x.trim()) || new Set(selected).size !== 3)
    throw new Error('Select three distinct existing chart-of-accounts names.');
  const names = [...new Set([...q.map((x) => x.account_full_name), ...selected])];
  const coveredAccounts = f.ledgerCoveredAccountNames
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    names.some((name) => !coveredAccounts.includes(name)) ||
    f.ledgerPeriodStart !== w.options.periodStart ||
    f.ledgerPeriodEnd !== w.options.periodEnd
  )
    throw new Error(
      'Record exact covered accounts, including the zero-activity fee account, and full period from the reviewed GL coverage document. COA selection is not ledger coverage.',
    );
  const knownEvidence = new Set([
    ...w.files.map((x) => x.hash),
    ...f.documents.map((x) => x.sha256),
  ]);
  for (const relation of f.relations.filter((x) => x.relation === 'OTHER_CASE')) {
    const other = w.review?.cases.find(
      (x) =>
        x.economicCaseId === relation.relatedCaseId &&
        x.economicCaseId !== r.economicCaseId &&
        x.identityStatus === 'BOUND',
    );
    const otherGroup = other && w.result.groups.find((x) => x.id === other.engineGroupId);
    const evidenceHash = relation.evidenceRef.split(':')[0];
    if (
      !otherGroup ||
      !q.some(
        (x) => otherGroup.qb_ids.includes(x.id) && x.transaction_id === relation.transactionId,
      ) ||
      !knownEvidence.has(evidenceHash) ||
      !/^[a-f0-9]{64}(?::row[1-9][0-9]*)?$/.test(relation.evidenceRef)
    )
      throw new Error(
        'Other-case ledger exclusion needs an actual different bound case and a known source/document SHA-256 reference, not an unsupported label.',
      );
  }
  for (const row of q.filter(
    (x) =>
      x.role === 'FEE' &&
      x.account_full_name !== f.feeAccountName &&
      (x.debit_cents || x.credit_cents),
  )) {
    if (
      [f.receiptTransactionId, f.settlementTransactionId].includes(row.transaction_id ?? '') ||
      !f.relations.some(
        (x) => x.transactionId === row.transaction_id && x.relation === 'OTHER_CASE',
      )
    )
      throw new Error(
        'Additional fee-role activity requires proven other-case association or manual accounting review.',
      );
  }
  const accounts: VerifiedAccount[] = f.reviewedAccounts;
  if (names.some((name) => !accounts.some((a) => a.name === name && a.id === name && a.exists)))
    throw new Error(
      'Review each actual chart-of-accounts record, its type and existence; selected labels do not establish account types.',
    );
  for (const [name, type] of [
    [f.bankAccountName, 'BANK'],
    [f.clearingAccountName, 'OTHER_CURRENT_ASSET'],
    [f.feeAccountName, 'EXPENSE'],
  ]) {
    if (accounts.find((a) => a.name === name)?.type !== type)
      throw new Error('Reviewed account type does not support the fee-only template.');
    if (
      q.some(
        (row) =>
          row.account_full_name === name &&
          row.account_type !== 'UNKNOWN' &&
          row.account_type !== type,
      )
    )
      throw new Error('Imported account type conflicts with the reviewed COA selection.');
  }
  if (
    accounts.find((a) => a.name === f.clearingAccountName)?.isUndepositedFunds !== false ||
    w.options.accountMap?.[f.clearingAccountName]?.isUndepositedFunds === true
  )
    throw new Error('Undeposited Funds is not eligible for an ordinary asset fee-only journal.');
  for (const row of q) {
    if (!row.transaction_id || !row.is_posted_ledger || row.validation_errors.length)
      throw new Error(
        'All reviewed GL rows need explicit transaction identity and valid posted-ledger semantics.',
      );
    if (
      row.account_full_name === f.clearingAccountName &&
      row.account_type === 'OTHER_CURRENT_LIABILITY'
    )
      throw new Error('Imported liability clearing conflicts with the ordinary-asset selection.');
  }
  const refs = (rows: { source_refs: { file_sha256: string; physical_row: number }[] }[]) =>
    rows.flatMap((x) => x.source_refs.map((p) => `${p.file_sha256}:row${p.physical_row}`));
  const residual = checkedSum(
    q
      .filter(
        (x) =>
          x.account_full_name === f.clearingAccountName &&
          [f.receiptTransactionId, f.settlementTransactionId].includes(x.transaction_id ?? ''),
      )
      .map((x) => x.signed_cents),
  );
  const input: FeeCase = {
    companyId: w.options.companyId,
    caseId: r.economicCaseId,
    adjustmentVersion: 'fee-only-v1',
    bankAccountId: f.bankAccountName,
    clearingAccountId: f.clearingAccountName,
    feeAccountId: f.feeAccountName,
    accounts,
    grossCents: g.gross_cents,
    bankNetCents: g.bank_cents,
    confirmedFeeCents: fee,
    clearingResidualCents: residual,
    feeMode: f.feeMode,
    settlementReference: r.accountingActionId,
    settlementEvidenceRef: settlementRef,
    stEvidenceRefs: refs(w.input.st.filter((x) => g.st_ids.includes(x.id))),
    bankEvidenceRefs: refs(w.input.bank.filter((x) => g.bank_ids.includes(x.id))),
    sourceFileHashes: [
      ...new Set([...w.files.map((x) => x.hash), ...f.documents.map((d) => d.sha256)]),
    ],
    // One digest of every source mapping: joining three 80-character versions
    // exceeded the 240-character import-text bound for every real three-file run.
    mappingVersion: w.result.versions.mapping.length
      ? `mapping-set-v1:${contentHash([...w.result.versions.mapping].sort())}`
      : 'reviewed-mapping',
    ruleVersion: FEE_ONLY_RULE_VERSION,
    journalDate: f.journalDate,
    periodOpenConfirmed: f.periodOpenConfirmed,
    netFeeConfirmed: f.netFeeConfirmed,
    receiptTransactionId: f.receiptTransactionId,
    settlementTransactionId: f.settlementTransactionId,
    postedGL: q.map((x) => ({
      transactionId: x.transaction_id!,
      journalId: x.num || x.transaction_id!,
      date: x.posting_date,
      accountId: x.account_full_name,
      debitCents: x.debit_cents,
      creditCents: x.credit_cents,
      posted: x.is_posted_ledger,
      evidenceRef: refs([x])[0],
    })),
    postedGLRelations: f.relations,
    ledgerCoverage: {
      periodStart: f.ledgerPeriodStart,
      periodEnd: f.ledgerPeriodEnd,
      asOfDate: w.options.asOfDate,
      accountIds: coveredAccounts,
      confirmed: f.completeLedgerConfirmed,
      evidenceRef: `${ledgerRef};${coaRef}`,
      reviewer: f.reviewer,
    },
    expenseNotRecordedConfirmed: f.expenseNotRecordedConfirmed,
    existingJournalIds: [
      ...q.flatMap((x) => (x.num ? [x.num] : [])),
      ...r.exportHistory.map((x) => x.journalId),
    ],
    existingImportStatus: r.existingImportStatus,
    syntheticOnly: w.isDemo,
  };
  return buildFeeProposal(input);
}

/**
 * Ledger and project facts that contradict reviewed UF deposit instructions. Each
 * item keeps the worksheet a candidate; it never blocks the investigation output.
 */
export function ufReviewConflicts(
  w: Workspace,
  g: EngineGroup,
  r: Pick<ReviewCase, 'economicCaseId'>,
  f: CaseFacts & { ufPayments?: { qbPaymentId: string }[] },
): string[] {
  const conflicts: string[] = [];
  const untrusted = sourceTrustBlocker(w);
  if (untrusted) conflicts.push(untrusted);
  const mine = new Set((f.ufPayments ?? []).map((p) => p.qbPaymentId.trim()).filter(Boolean));
  for (const other of w.review?.cases ?? []) {
    if (other.economicCaseId === r.economicCaseId) continue;
    const listed = (other.reviewedFacts as { ufPayments?: { qbPaymentId?: unknown }[] }).ufPayments;
    for (const p of Array.isArray(listed) ? listed : [])
      if (typeof p?.qbPaymentId === 'string' && mine.has(p.qbPaymentId.trim()))
        conflicts.push(
          `QB Payment ${p.qbPaymentId.trim()} is also listed for case ${other.economicCaseId}. One payment can be deposited only once; resolve which case it belongs to.`,
        );
  }
  const caseRows = w.input.qb.filter((x) => g.qb_ids.includes(x.id));
  for (const row of caseRows.filter(
    (x) =>
      x.debit_cents > 0 &&
      (x.role === 'BANK' ||
        x.account_type === 'BANK' ||
        (!!f.bankAccountName && x.account_full_name === f.bankAccountName)),
  ))
    conflicts.push(
      `The GL already contains a posted bank deposit leg for this case (transaction ${row.transaction_id ?? row.id}, ${(row.debit_cents / 100).toFixed(2)} USD). Match the bank feed to that existing deposit; do not create another deposit.`,
    );
  if (f.feeAccountName)
    for (const row of w.input.qb.filter(
      (x) =>
        x.account_full_name === f.feeAccountName &&
        (x.debit_cents || x.credit_cents) &&
        !f.relations.some(
          (rel) => rel.transactionId === x.transaction_id && rel.relation === 'OTHER_CASE',
        ),
    ))
      conflicts.push(
        `The fee account already has posted activity (transaction ${row.transaction_id ?? row.id}) that is linked to this case or not yet associated. Review it before adding a deposit fee line.`,
      );
  return [...new Set(conflicts)];
}
