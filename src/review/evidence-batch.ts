import type { Workspace } from '../components/workspace';
import type { ReviewCase } from './types';
import type { CaseFacts } from './case-adapter';

export interface EvidenceBatch {
  evidenceHash: string;
  relatedCaseId: string;
  transactionIds: string[];
  reviewer: string;
}

/** All-or-nothing human review convenience, never a matching or approval engine. */
export function associateEvidenceBatch(
  w: Workspace,
  current: ReviewCase,
  facts: CaseFacts,
  batch: EvidenceBatch,
): CaseFacts['relations'] {
  if (!batch.reviewer.trim()) throw new Error('Record the reviewer before batch association.');
  if (
    !/^[a-f0-9]{64}$/.test(batch.evidenceHash) ||
    ![...w.files.map((f) => f.hash), ...facts.documents.map((d) => d.sha256)].includes(
      batch.evidenceHash,
    )
  )
    throw new Error('Choose a known source or supporting document SHA-256.');
  const other = w.review?.cases.find(
    (c) =>
      c.economicCaseId === batch.relatedCaseId &&
      c.economicCaseId !== current.economicCaseId &&
      c.identityStatus === 'BOUND',
  );
  const group = other && w.result.groups.find((g) => g.id === other.engineGroupId);
  const currentGroup = w.result.groups.find((g) => g.id === current.engineGroupId);
  if (!group || !currentGroup) throw new Error('Choose a different existing bound economic case.');
  if (
    !batch.transactionIds.length ||
    batch.transactionIds.length > 20000 ||
    batch.transactionIds.some((id) => !id.trim() || id !== id.trim()) ||
    new Set(batch.transactionIds).size !== batch.transactionIds.length
  )
    throw new Error(
      'Explicitly list unique transaction IDs; empty or duplicate lists are invalid.',
    );
  const currentIds = new Set([
    facts.receiptTransactionId,
    facts.settlementTransactionId,
    ...w.input.qb.filter((q) => currentGroup.qb_ids.includes(q.id)).map((q) => q.transaction_id),
  ]);
  for (const id of batch.transactionIds) {
    if (
      currentIds.has(id) ||
      !w.input.qb.some((q) => group.qb_ids.includes(q.id) && q.transaction_id === id)
    )
      throw new Error(
        `Transaction ${id} is not exclusively outside this case and in the chosen case.`,
      );
    const existing = facts.relations.filter((r) => r.transactionId === id);
    if (
      existing.length > 1 ||
      existing.some(
        (r) =>
          r.relation !== 'UNKNOWN' &&
          (r.relation !== 'OTHER_CASE' ||
            r.relatedCaseId !== batch.relatedCaseId ||
            r.evidenceRef !== batch.evidenceHash ||
            r.reviewer !== batch.reviewer.trim()),
      )
    )
      throw new Error(`Transaction ${id} already has a different review. Review it individually.`);
  }
  // No ledger row, amount, import status, export history or accounting blocker is changed.
  return [
    ...facts.relations.filter((r) => !batch.transactionIds.includes(r.transactionId)),
    ...batch.transactionIds.map((transactionId) => ({
      transactionId,
      relation: 'OTHER_CASE' as const,
      relatedCaseId: batch.relatedCaseId,
      evidenceRef: batch.evidenceHash,
      reviewer: batch.reviewer.trim(),
    })),
  ];
}
