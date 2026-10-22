import { z } from 'zod';
import type { Workspace } from '../components/workspace';
import type { EngineGroup } from '../contracts/engine';
import { reconcile } from '../engine';
import { contentHash, typedIdentity } from '../engine/identities';
import type { ReviewCase, ReviewProjectState } from './types';
export const REVIEW_SCHEMA_VERSION = 1 as const;
export const MAX_PROJECT_BYTES = 40 * 1024 * 1024;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(4096);
const strArray = z.array(text).max(60000);
const exportSchema = z
  .object({
    journalId: text,
    proposalId: text,
    proposalHash: hash,
    exportedAt: z.string().datetime(),
    status: z.enum(['EXPORTED_NOT_POSTED', 'UNKNOWN', 'PARTIAL', 'IMPORTED']),
    format: z.enum(['csv', 'iif']),
  })
  .strict();
const factsSchema = z
  .object({
    reviewer: z.string(),
    notes: z.string(),
    journalDate: z.string(),
    bankAccountName: z.string(),
    clearingAccountName: z.string(),
    feeAccountName: z.string(),
    receiptTransactionId: z.string(),
    settlementTransactionId: z.string(),
    documentedFee: z.string(),
    feeMode: z.enum(['NETTED', 'SEPARATE_INVOICE', 'GROSS_SETTLED', 'UNKNOWN']),
    netFeeConfirmed: z.boolean(),
    periodOpenConfirmed: z.boolean(),
    expenseNotRecordedConfirmed: z.boolean(),
    completeLedgerConfirmed: z.boolean(),
    ledgerCoveredAccountNames: z.string(),
    ledgerPeriodStart: z.string(),
    ledgerPeriodEnd: z.string(),
    accountsReviewed: z.boolean(),
    clearingIsOrdinaryAsset: z.boolean(),
    documents: z
      .array(
        z.object({
          name: z.string(),
          sha256: hash,
          purpose: z.enum(['SETTLEMENT', 'COA', 'LEDGER']),
          sizeBytes: z.number().int().nonnegative(),
        }),
      )
      .max(100),
    reviewedAccounts: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.enum([
            'BANK',
            'OTHER_CURRENT_ASSET',
            'EXPENSE',
            'OTHER_CURRENT_LIABILITY',
            'OTHER',
            'UNKNOWN',
          ]),
          exists: z.boolean(),
          isUndepositedFunds: z.boolean().nullable(),
        }),
      )
      .max(10000),
    relations: z
      .array(
        z.object({
          transactionId: z.string(),
          relation: z.enum(['THIS_CASE', 'OTHER_CASE', 'UNKNOWN']),
          relatedCaseId: z.string().nullable(),
          evidenceRef: z.string(),
          reviewer: z.string(),
        }),
      )
      .max(20000),
    ufPayments: z
      .array(
        z.object({
          qbPaymentId: z.string(),
          amountCents: z.number().int().safe(),
          inUndepositedFunds: z.boolean().nullable(),
          existingDepositId: z.string().nullable(),
          depositStatusReviewed: z.boolean(),
          statusEvidenceRef: z.string(),
        }),
      )
      .max(20000),
  })
  .partial()
  .passthrough();
export function validateReviewFacts(facts: Record<string, unknown>): Record<string, unknown> {
  safeTree(facts);
  return factsSchema.parse(facts);
}
const caseSchema = z
  .object({
    economicCaseId: text,
    accountingActionId: text,
    engineGroupId: text,
    anchors: strArray,
    inputDigest: hash,
    identityStatus: z.enum(['BOUND', 'UNCERTAIN']),
    reviewedFacts: factsSchema,
    proposal: z.unknown().optional(),
    exportHistory: z.array(exportSchema).max(10000),
    existingImportStatus: z.enum(['NEVER_IMPORTED', 'UNKNOWN', 'PARTIAL', 'IMPORTED']),
  })
  .strict();
const reviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    inputDigest: hash,
    cases: z.array(caseSchema).max(60000),
    orphanedCases: z.array(caseSchema).max(60000),
  })
  .strict();
const rowSchema = z
  .object({
    id: text,
    company_id: text,
    currency: z.literal('USD'),
    validation_errors: z.array(z.string()),
    source_refs: z
      .array(
        z
          .object({
            file_sha256: hash,
            raw_row_sha256: hash,
            physical_row: z.number().int().positive(),
            sheet: z.string().nullable(),
            column_indices: z.record(z.array(z.number().int().nonnegative())),
            parser_version: text,
            mapping_version: text,
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();
const manifestSchema = z
  .object({
    company_id: text,
    source_file_sha256: hash,
    source_system: text,
    period_start: text,
    period_end: text,
    as_of_date: text,
    missing_required_fields: z.array(z.string()),
    accounts: z.array(z.string()),
    account_balances: z.array(z.unknown()),
  })
  .passthrough();
const workspaceSchema = z
  .object({
    input: z
      .object({
        st: z.array(rowSchema).max(20000),
        qb: z.array(rowSchema).max(20000),
        bank: z.array(rowSchema).max(20000),
        manifests: z.array(manifestSchema).max(100),
        evidence: z.record(z.unknown()).optional(),
        config: z.record(z.unknown()).optional(),
      })
      .strict(),
    result: z.unknown(),
    duration: z.number().nonnegative().finite(),
    isDemo: z.boolean(),
    files: z
      .array(
        z
          .object({
            name: text,
            kind: z.enum([
              'ST',
              'QBO',
              'QBD',
              'BANK',
              'PROCESSOR',
              'AUDIT',
              'RECEIPT',
              'COMPONENT',
            ]),
            hash,
            sizeBytes: z.number().int().nonnegative().optional(),
          })
          .passthrough(),
      )
      .max(100),
    options: z
      .object({
        companyId: text,
        bankAccountId: text,
        companyTimezone: text,
        periodStart: text,
        periodEnd: text,
        asOfDate: text,
        currency: z.literal('USD'),
      })
      .passthrough(),
    runId: text,
    review: reviewSchema.optional(),
  })
  .strict();
/** Hashes detect accidental modification, not authorship or trusted financial evidence. */
export function reviewInputDigest(w: Workspace): string {
  return contentHash({
    input: w.input,
    files: w.files,
    options: w.options,
    versions: w.result.versions,
  });
}
function anchorsFor(w: Workspace, g: EngineGroup): string[] {
  const keys: string[] = [];
  const add = (system: string, kind: string, value: string | null) => {
    if (value)
      keys.push(
        typedIdentity(g.company_id, system, kind, JSON.stringify([g.bank_account_id, value])),
      );
  };
  for (const r of w.input.st.filter((r) => g.st_ids.includes(r.id)))
    add('ST', 'payment', r.source_payment_id);
  for (const r of w.input.bank.filter((r) => g.bank_ids.includes(r.id))) {
    add('BANK', 'transaction', r.source_transaction_id);
    add('BANK', 'deposit', r.deposit_id);
  }
  // Only use QB identity when no receipt/bank anchors are available. Adding GL must not change economic identity.
  if (!keys.length)
    for (const r of w.input.qb.filter((r) => g.qb_ids.includes(r.id)))
      add(r.qb_product, 'transaction', r.transaction_id);
  return [...new Set(keys)].sort();
}
function invalidate(c: ReviewCase): ReviewCase {
  const next = structuredClone(c);
  if (next.exportHistory.length && next.existingImportStatus === 'NEVER_IMPORTED')
    next.existingImportStatus = 'UNKNOWN';
  if (next.proposal) {
    next.proposal.state = 'DRAFT';
    next.proposal.approval = null;
    if (next.exportHistory.length)
      next.proposal.feeCase.existingImportStatus = next.existingImportStatus;
  }
  return next;
}
export function initializeReview(w: Workspace, previous?: ReviewProjectState): ReviewProjectState {
  const inputDigest = reviewInputDigest(w);
  const prior = [...(previous?.cases ?? []), ...(previous?.orphanedCases ?? [])];
  const groups = w.result.groups.map((g) => ({ g, anchors: anchorsFor(w, g) }));
  const byExact = new Map<string, ReviewCase[]>(),
    byAnchor = new Map<string, ReviewCase[]>();
  const anchorCounts = new Map<string, number>();
  for (const { anchors } of groups) {
    const key = contentHash(anchors);
    anchorCounts.set(key, (anchorCounts.get(key) ?? 0) + 1);
  }
  for (const c of prior) {
    const exact = JSON.stringify([c.engineGroupId, contentHash(c.anchors)]);
    byExact.set(exact, [...(byExact.get(exact) ?? []), c]);
    for (const anchor of c.anchors) byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), c]);
  }
  const matches = groups.map(({ g, anchors }) => {
    const exact = byExact.get(JSON.stringify([g.id, contentHash(anchors)])) ?? [];
    if (exact.length === 1) return exact;
    return [...new Set(anchors.flatMap((a) => byAnchor.get(a) ?? []))];
  });
  const matchCounts = new Map<string, number>();
  for (const ms of matches)
    for (const c of ms)
      matchCounts.set(c.economicCaseId, (matchCounts.get(c.economicCaseId) ?? 0) + 1);
  const hasPriorExports = prior.some((c) => c.exportHistory.length > 0);
  const consumed = new Set<string>();
  const cases = groups.map(({ g, anchors }, i): ReviewCase => {
    const candidates = matches[i]!;
    const old =
      candidates.length === 1 && matchCounts.get(candidates[0]!.economicCaseId) === 1
        ? candidates[0]
        : undefined;
    if (old) {
      consumed.add(old.economicCaseId);
      const next =
        old.inputDigest === inputDigest && !old.exportHistory.length
          ? structuredClone(old)
          : invalidate(old);
      return {
        ...next,
        engineGroupId: g.id,
        anchors: [...new Set([...old.anchors, ...anchors])].sort(),
        inputDigest,
      };
    }
    const economicCaseId =
      'case-' +
      contentHash({
        company: g.company_id,
        bank: g.bank_account_id,
        anchors: anchors.length ? anchors : [g.id],
        ambiguousGroup:
          candidates.length || (anchorCounts.get(contentHash(anchors)) ?? 0) > 1 ? g.id : null,
      }).slice(0, 24);
    const uncertain =
      anchors.length === 0 ||
      candidates.length > 0 ||
      (anchorCounts.get(contentHash(anchors)) ?? 0) > 1 ||
      hasPriorExports;
    return {
      economicCaseId,
      accountingActionId: 'fee-' + contentHash(economicCaseId).slice(0, 24),
      engineGroupId: g.id,
      anchors,
      inputDigest,
      identityStatus: uncertain ? 'UNCERTAIN' : 'BOUND',
      reviewedFacts: {},
      exportHistory: candidates.flatMap((c) => c.exportHistory),
      existingImportStatus: uncertain ? 'UNKNOWN' : 'NEVER_IMPORTED',
    };
  });
  return {
    schemaVersion: 1,
    inputDigest,
    cases,
    orphanedCases: prior.filter((c) => !consumed.has(c.economicCaseId)).map(invalidate),
  };
}
export function reviewForGroup(state: ReviewProjectState, groupId: string): ReviewCase | undefined {
  return state.cases.find((c) => c.engineGroupId === groupId);
}
/** A material review edit always revokes the proposal; export history is never cleared. */
export function updateReviewFacts(
  state: ReviewProjectState,
  caseId: string,
  facts: Record<string, unknown>,
): ReviewProjectState {
  validateReviewFacts(facts);
  const next = structuredClone(state);
  const item = next.cases.find((c) => c.economicCaseId === caseId);
  if (!item) throw new Error('Review case no longer exists. Reopen the current group.');
  if (contentHash(item.reviewedFacts) !== contentHash(facts)) {
    item.reviewedFacts = structuredClone(facts);
    delete item.proposal;
  }
  return next;
}
function safeTree(v: unknown, depth = 0): void {
  if (depth > 40) throw new Error('Project nesting exceeds supported depth.');
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Non-finite project number.');
  if (typeof v === 'string' && v.length > 100000)
    throw new Error('Project text field exceeds limit.');
  if (v && typeof v === 'object')
    for (const [k, child] of Object.entries(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(k))
        throw new Error('Unsafe project key.');
      safeTree(child, depth + 1);
    }
}
function validateSources(w: Workspace): void {
  const hashes = new Set(w.files.map((f) => f.hash));
  if (hashes.size !== w.files.length) throw new Error('Duplicate source-file identities.');
  const manifests = new Set(w.input.manifests.map((m) => m.source_file_sha256));
  if ([...hashes].some((h) => !manifests.has(h)) || [...manifests].some((h) => !hashes.has(h)))
    throw new Error('Source files and manifests do not agree.');
  for (const m of w.input.manifests)
    if (m.company_id !== w.options.companyId) throw new Error('Source company mismatch.');
  const rows = [
    ...w.input.st,
    ...w.input.qb,
    ...w.input.bank,
    ...Object.values(w.input.evidence ?? {}).flat(),
  ];
  for (const row of rows) {
    if (
      row.company_id !== w.options.companyId ||
      row.currency !== 'USD' ||
      !Array.isArray(row.source_refs) ||
      !row.source_refs.length
    )
      throw new Error('Invalid source company or provenance.');
    for (const p of row.source_refs)
      if (!hashes.has(p.file_sha256)) throw new Error('Row references an unavailable source.');
  }
}
export function serializeProject(workspace: Workspace): string {
  const w = structuredClone(workspace);
  w.review = initializeReview(w, w.review);
  // Original raw bytes are not silently embedded; canonical rows retain source hashes/locators.
  delete w.options.originalBytes;
  const payload = {
    format: 'reconciliation-review-project',
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    workspace: w,
  };
  const result = JSON.stringify({ ...payload, integrity: contentHash(payload) }, null, 2);
  if (new TextEncoder().encode(result).length > MAX_PROJECT_BYTES)
    throw new Error('Review project exceeds 40 MB.');
  return result;
}
export function openProject(serialized: string): Workspace {
  if (new TextEncoder().encode(serialized).length > MAX_PROJECT_BYTES)
    throw new Error('Review project exceeds 40 MB.');
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new Error('Invalid review project JSON. Choose an unmodified saved review project.');
  }
  safeTree(raw);
  const checkedEnvelope = z
    .object({
      format: z.literal('reconciliation-review-project'),
      schemaVersion: z.literal(1),
      savedAt: z.string().datetime(),
      workspace: workspaceSchema,
      integrity: hash,
    })
    .strict()
    .safeParse(raw);
  if (!checkedEnvelope.success) {
    const paths = checkedEnvelope.error.issues
      .slice(0, 3)
      .map((issue) => issue.path.join('.') || 'project')
      .join(', ');
    throw new Error(
      `Review project validation failed (${paths}). Use a supported schema version 1 project. The current workspace was not replaced.`,
    );
  }
  const envelope = checkedEnvelope.data;
  const { integrity, ...payload } = envelope;
  if (contentHash(payload) !== integrity)
    throw new Error('Project integrity mismatch; use an unmodified saved project.');
  const w = envelope.workspace as unknown as Workspace;
  validateSources(w);
  const restored = w.review;
  // Do not load a claimed engine result. Deterministically recompute from the normalized input.
  w.result = reconcile(w.input);
  if (
    w.result.warnings.some((x) =>
      ['INVALID_SOURCE', 'MANIFEST_DATE_INVALID', 'MANIFEST_COMPANY_CONFLICT'].includes(x.code),
    )
  )
    throw new Error('Saved project contains invalid source rows.');
  w.duration = 0;
  if (restored)
    for (const c of [...restored.cases, ...restored.orphanedCases]) {
      if (c.proposal) {
        // Saved drafts can be obsolete or no longer eligible. Restore for inspection,
        // never grant approval here; the builder/serializer must revalidate current rules.
        z.object({
          proposalId: text,
          journalId: text,
          date: text,
          feeCase: z.object({ caseId: text }).passthrough(),
          lines: z
            .array(
              z.object({
                accountId: text,
                account: text,
                debitCents: z.number().int().nonnegative(),
                creditCents: z.number().int().nonnegative(),
                memo: z.string(),
              }),
            )
            .max(100),
          state: z.enum(['DRAFT', 'APPROVED']),
          approval: z.unknown(),
        }).parse(c.proposal);
        if (c.proposal.feeCase.caseId !== c.economicCaseId)
          throw new Error('Proposal case identity mismatch.');
      }
      if (c.exportHistory.length && c.existingImportStatus === 'NEVER_IMPORTED')
        c.existingImportStatus = 'UNKNOWN';
    }
  w.review = initializeReview(w, restored);
  w.review.cases = w.review.cases.map(invalidate);
  w.review.orphanedCases = w.review.orphanedCases.map(invalidate);
  return w;
}
