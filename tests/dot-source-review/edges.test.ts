import { it, expect } from 'vitest';
import { sessionWorkspace, feeGroup, documentedFacts } from '../claude-review/fee-case-fixture';
import { reconcile } from '../../src/engine';
import { normalize } from '../../src/engine/normalize';
import { settlementOptions } from '../../src/engine/edges';
import { initializeReview, reviewForGroup } from '../../src/review/project';
import { proposalFromCase } from '../../src/review/case-adapter';
import type { EvidenceBundle } from '../../src/contracts/engine';
it('F06 split semantics alone are SUPPORTED and cannot grant fee-only drafting', async () => {
  const w = await sessionWorkspace();
  w.input.qb = w.input.qb.filter((q) => q.role !== 'BANK');
  w.input.config!.clearing_split_semantics_confirmed = true;
  w.result = reconcile(structuredClone(w.input));
  w.review = initializeReview(w);
  const g = feeGroup(w);
  expect(g.edges.find((e) => e.kind === 'QB_BANK_SETTLEMENT')?.state).toBe('SUPPORTED');
  await expect(
    proposalFromCase(w, g, reviewForGroup(w.review!, g.id)!, documentedFacts(w)),
  ).rejects.toThrow(/supported, not confirmed/);
});
it('F06 actual bank leg or itemized confirmation independently confirms the settlement edge', async () => {
  const w = await sessionWorkspace();
  expect(feeGroup(w).edges.find((e) => e.kind === 'QB_BANK_SETTLEMENT')?.state).toBe('CONFIRMED');
  w.input.qb = w.input.qb.filter((q) => q.role !== 'BANK');
  const evidence: Required<EvidenceBundle> = {
    settlements: [],
    deposit_components: [],
    external_receipts: [],
    audit_events: [],
    confirmations: [
      {
        id: 'confirmation',
        company_id: w.options.companyId,
        bank_account_id: w.options.bankAccountId,
        currency: 'USD',
        evidence_ref: 'synthetic-attestation:row2',
        deposit_reference: 'SYN-SET-900',
        qb_transaction_id: 'SYN-QB-D900',
        bank_effect_cents: 910000,
        expense_coverage_confirmed: true,
        fee_not_recorded: true,
        clearing_account_id: 'ServiceTitan Clearing',
        fee_account_name: 'Merchant Processing Fees',
        accounts_verified: true,
        period_open: true,
        reviewer: 'Synthetic reviewer',
        source_refs: w.input.qb[0].source_refs,
      },
    ],
  };
  const options = settlementOptions(w.input.bank, normalize(w.input), w.input, evidence);
  expect(options[0].edge.state).toBe('CONFIRMED');
  expect(options[0].edge.evidence_refs).toEqual(['synthetic-attestation:row2']);
});
