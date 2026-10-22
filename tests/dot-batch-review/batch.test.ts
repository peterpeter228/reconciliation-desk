import { describe, expect, it } from 'vitest';
import { associateEvidenceBatch } from '../../src/review/evidence-batch';
import { monthFixture } from './fixture';
import { proposalFromCase } from '../../src/review/case-adapter';

describe('Evidence-bound explicit OTHER_CASE batches', () => {
  it('preserves every ledger row and export state, associates only explicit IDs', async () => {
    const { w, current, facts, batches } = await monthFixture();
    const before = structuredClone(w);
    const batch = { ...batches[0], transactionIds: batches[0].transactionIds.slice(0, 2) };
    const relations = associateEvidenceBatch(w, current, facts, batch);
    expect(relations).toHaveLength(2);
    expect(relations.map((r) => r.transactionId)).toEqual(batch.transactionIds);
    expect(
      relations.every(
        (r) => r.evidenceRef === batch.evidenceHash && r.relatedCaseId === batch.relatedCaseId,
      ),
    ).toBe(true);
    expect(w).toEqual(before);
    expect(facts.relations).toEqual([]);
  });
  it.each([
    'empty',
    'duplicate',
    'unknown-hash',
    'fake-case',
    'same-case',
    'wrong-transaction',
    'current-transaction',
    'no-reviewer',
    'uncertain-case',
    'conflicting-review',
  ])('rejects %s atomically', async (variant) => {
    const { w, current, facts, batches } = await monthFixture();
    const batch = structuredClone(batches[0]);
    if (variant === 'empty') batch.transactionIds = [];
    if (variant === 'duplicate') batch.transactionIds.push(batch.transactionIds[0]);
    if (variant === 'unknown-hash') batch.evidenceHash = 'f'.repeat(64);
    if (variant === 'fake-case') batch.relatedCaseId = 'imaginary';
    if (variant === 'same-case') batch.relatedCaseId = current.economicCaseId;
    if (variant === 'wrong-transaction') batch.transactionIds.push(batches[1].transactionIds[0]);
    if (variant === 'current-transaction') batch.transactionIds.push(facts.receiptTransactionId);
    if (variant === 'no-reviewer') batch.reviewer = ' ';
    if (variant === 'uncertain-case')
      w.review!.cases.find((c) => c.economicCaseId === batch.relatedCaseId)!.identityStatus =
        'UNCERTAIN';
    if (variant === 'conflicting-review')
      facts.relations.push({
        transactionId: batch.transactionIds[0],
        relation: 'THIS_CASE',
        relatedCaseId: current.economicCaseId,
        evidenceRef: batch.evidenceHash,
        reviewer: batch.reviewer,
      });
    const before = structuredClone({ w, facts });
    expect(() => associateEvidenceBatch(w, current, facts, batch)).toThrow();
    expect({ w, facts }).toEqual(before);
  });
  it('does not clear UNKNOWN import policy even after every explicit relation is recorded', async () => {
    const { w, g, current, facts, batches } = await monthFixture();
    for (const batch of batches) facts.relations = associateEvidenceBatch(w, current, facts, batch);
    current.existingImportStatus = 'UNKNOWN';
    await expect(proposalFromCase(w, g, current, facts)).rejects.toThrow(
      /prior or uncertain import history/,
    );
    expect(facts.relations).toHaveLength(60);
  });
});
