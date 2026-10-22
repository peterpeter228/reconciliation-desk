import { z } from 'zod';
import type { ReviewCase } from './types';
import { contentHash } from '../engine/identities';

const checkSchema = z
  .object({
    journalId: z.string().trim().min(1).max(4096),
    reviewer: z.string().trim().min(1).max(4096),
    checkedAt: z.string().datetime(),
    glReportHash: z.string().regex(/^[a-f0-9]{64}$/),
    result: z.enum(['FOUND', 'NOT_FOUND']),
    scopeAndMethod: z.string().trim().min(1).max(4096),
  })
  .strict();
export type JournalCheck = z.infer<typeof checkSchema>;
export interface RecoveryPrototype {
  kind: 'UNKNOWN_RECOVERY_REVIEW_ONLY';
  economicCaseId: string;
  accountingActionId: string;
  exportHistoryHash: string;
  history: JournalCheck[];
  accountingExportAllowed: false;
  sameJournalRedownload: 'OWNER_POLICY_DECISION_REQUIRED';
}

/** Unwired sidecar prototype. Reports a human statement, never proof of posting/absence. */
export function recordJournalCheck(
  review: ReviewCase,
  prior: RecoveryPrototype | undefined,
  input: JournalCheck,
  knownGlReportHashes: readonly string[],
): RecoveryPrototype {
  const check = checkSchema.parse(input);
  if (review.existingImportStatus !== 'UNKNOWN' || !review.exportHistory.length)
    throw new Error('Prototype only accepts an UNKNOWN case with retained export history.');
  if (!review.exportHistory.some((e) => e.journalId === check.journalId))
    throw new Error('Check must name an existing exported journal number.');
  if (!knownGlReportHashes.includes(check.glReportHash))
    throw new Error('Attach the actual GL report and use its known SHA-256.');
  const exportHistoryHash = contentHash(review.exportHistory);
  if (
    prior &&
    (prior.kind !== 'UNKNOWN_RECOVERY_REVIEW_ONLY' ||
      prior.economicCaseId !== review.economicCaseId ||
      prior.accountingActionId !== review.accountingActionId ||
      prior.exportHistoryHash !== exportHistoryHash ||
      prior.accountingExportAllowed !== false ||
      prior.sameJournalRedownload !== 'OWNER_POLICY_DECISION_REQUIRED')
  )
    throw new Error(
      'Prior review is for a different case/export history or policy. Retain it separately.',
    );
  const history = (prior?.history ?? []).map((entry) => checkSchema.parse(entry));
  return {
    kind: 'UNKNOWN_RECOVERY_REVIEW_ONLY',
    economicCaseId: review.economicCaseId,
    accountingActionId: review.accountingActionId,
    exportHistoryHash,
    history: [...history, check],
    accountingExportAllowed: false,
    sameJournalRedownload: 'OWNER_POLICY_DECISION_REQUIRED',
  };
}
