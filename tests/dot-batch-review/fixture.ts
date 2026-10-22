import { sessionWorkspace, feeGroup, documentedFacts } from '../claude-review/fee-case-fixture';
import { reviewForGroup } from '../../src/review/project';

/** Controlled synthetic full-month UI fixture, not an independent engine-matching claim. */
export async function monthFixture(caseCount = 10, transactionsPerCase = 6) {
  const w = await sessionWorkspace();
  const g = feeGroup(w);
  const current = reviewForGroup(w.review!, g.id)!;
  const facts = documentedFacts(w);
  const batches = [];
  for (let i = 1; i <= caseCount; i++) {
    const transactionIds = Array.from(
      { length: transactionsPerCase },
      (_, j) => `SYN-MONTH-${i}-${j + 1}`,
    );
    const rows = transactionIds.map((transaction_id) => ({
      ...structuredClone(w.input.qb[0]),
      id: `ROW-${transaction_id}`,
      transaction_id,
      account_full_name: facts.clearingAccountName,
    }));
    w.input.qb.push(...rows);
    const other = {
      ...structuredClone(current),
      economicCaseId: `SYN-CASE-${i}`,
      engineGroupId: `SYN-GROUP-${i}`,
      accountingActionId: `SYN-ACTION-${i}`,
      reviewedFacts: {},
    };
    w.review!.cases.push(other);
    w.result.groups.push({
      ...structuredClone(g),
      id: other.engineGroupId,
      qb_ids: rows.map((r) => r.id),
      st_ids: [],
      bank_ids: [],
    });
    batches.push({
      evidenceHash: w.files[1].hash,
      relatedCaseId: other.economicCaseId,
      transactionIds,
      reviewer: facts.reviewer,
    });
  }
  return { w, g, current, facts, batches };
}
