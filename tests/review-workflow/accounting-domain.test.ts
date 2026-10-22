import { describe, it, expect } from 'vitest';
import { createTeachingFeeCase, buildFeeProposal, approveProposal } from '../../src/export/aje';
import { exportQboCsv } from '../../src/export/qbo';
import { buildUfWorksheet, type UfWorksheetInput } from '../../src/export/evidence';
function extraFee(amount = 10000) {
  const c = createTeachingFeeCase();
  c.postedGL.push(
    ...[
      { accountId: 'FEES', debitCents: amount, creditCents: 0 },
      { accountId: 'CLEARING', debitCents: 0, creditCents: amount },
    ].map((l) => ({
      ...l,
      transactionId: 'THIRD-JOURNAL',
      journalId: 'THIRD-JOURNAL',
      date: '2026-09-20',
      posted: true,
      evidenceRef: 'full-month:rows-7-8',
    })),
  );
  return c;
}
describe('Complete-month fee case association', () => {
  it('retains unrelated $100 fee GL and allows the documented $900 case', async () => {
    const c = extraFee();
    c.postedGLRelations = [
      {
        transactionId: 'THIRD-JOURNAL',
        relation: 'OTHER_CASE',
        relatedCaseId: 'OTHER-ECONOMIC-CASE',
        evidenceRef: 'settlement-other:case-link',
        reviewer: 'Local reviewer',
      },
    ];
    const p = await buildFeeProposal(c);
    expect(p.feeCase.postedGL).toHaveLength(6);
    expect(p.lines.map((l) => l.accountId)).toEqual(['FEES', 'CLEARING']);
    expect(p.lines.map((l) => l.debitCents - l.creditCents)).toEqual([90000, -90000]);
    const approved = await approveProposal(p, 'Local reviewer');
    approved.feeCase.postedGLRelations![0].evidenceRef = 'altered';
    await expect(exportQboCsv(approved)).rejects.toThrow();
  });
  it.each([10000, 90000])('blocks unknown third-journal fee %s', async (amount) => {
    await expect(buildFeeProposal(extraFee(amount))).rejects.toThrow(/association is unknown/);
  });
  it('blocks case-linked partial fee and its reversal even if net zero', async () => {
    const c = extraFee();
    c.postedGLRelations = [
      {
        transactionId: 'THIRD-JOURNAL',
        relation: 'THIS_CASE',
        relatedCaseId: c.caseId,
        evidenceRef: 'fee-statement',
        reviewer: 'Local reviewer',
      },
    ];
    c.postedGL.push({ ...c.postedGL[4], debitCents: 0, creditCents: 10000 });
    await expect(buildFeeProposal(c)).rejects.toThrow(/fee entry/);
  });
  it('does not permit an OTHER association for the bound deposit', async () => {
    const c = createTeachingFeeCase();
    c.postedGLRelations = [
      {
        transactionId: c.settlementTransactionId,
        relation: 'OTHER_CASE',
        relatedCaseId: 'OTHER',
        evidenceRef: 'wrong',
        reviewer: 'Local reviewer',
      },
    ];
    await expect(buildFeeProposal(c)).rejects.toThrow(/Contradictory/);
  });
  it.each([10000, 90000, -10000])(
    'blocks a case-linked fee or reversal on a different expense account (%s)',
    async (amount) => {
      const c = createTeachingFeeCase();
      c.accounts.push({
        id: 'OTHER-FEE',
        name: 'Other Expense',
        type: 'EXPENSE',
        exists: true,
        isUndepositedFunds: false,
      });
      c.ledgerCoverage.accountIds.push('OTHER-FEE');
      c.postedGL.push(
        ...[
          {
            accountId: 'OTHER-FEE',
            debitCents: Math.max(amount, 0),
            creditCents: Math.max(-amount, 0),
          },
          { accountId: 'BANK', debitCents: Math.max(-amount, 0), creditCents: Math.max(amount, 0) },
        ].map((leg) => ({
          ...leg,
          transactionId: 'SAME-CASE-EXTRA',
          journalId: 'EXTRA',
          date: '2026-09-20',
          posted: true,
          evidenceRef: 'full-month:other-expense-rows',
        })),
      );
      c.postedGLRelations = [
        {
          transactionId: 'SAME-CASE-EXTRA',
          relation: 'THIS_CASE',
          relatedCaseId: c.caseId,
          evidenceRef: 'same-case-statement',
          reviewer: 'Local reviewer',
        },
      ];
      await expect(buildFeeProposal(c)).rejects.toThrow(/Additional case-linked/);
    },
  );
  it('requires evidence for third-journal clearing reclassification too', async () => {
    const c = extraFee();
    c.postedGL[4].accountId = 'AR';
    await expect(buildFeeProposal(c)).rejects.toThrow(/Additional clearing/);
  });
  it('rejects empty evidence, duplicate associations and stale rule version', async () => {
    const c = extraFee();
    c.postedGLRelations = [
      {
        transactionId: 'THIRD-JOURNAL',
        relation: 'OTHER_CASE',
        relatedCaseId: 'OTHER',
        evidenceRef: '',
        reviewer: 'Local reviewer',
      },
    ];
    await expect(buildFeeProposal(c)).rejects.toThrow();
    c.postedGLRelations[0].evidenceRef = 'statement';
    c.postedGLRelations.push({ ...c.postedGLRelations[0] });
    await expect(buildFeeProposal(c)).rejects.toThrow(/unique/);
    const old = createTeachingFeeCase();
    old.ruleVersion = 'fee-only-1.1';
    await expect(buildFeeProposal(old)).rejects.toThrow(/Unsupported/);
  });
});
const uf = (): UfWorksheetInput => ({
  paymentIds: ['ST-A', 'ST-B', 'ST-C', 'ST-D'],
  bankAccount: 'Existing checking',
  bankAccountVerified: true,
  bankNetCents: 5000000,
  bankEvidenceRef: 'bank-statement:row-20',
  depositDate: '2026-09-20',
  grossCents: 5315000,
  feeCents: 315000,
  feeAccount: 'Merchant Fees',
  feeAccountVerified: true,
  feeEvidenceRef: 'settlement:netted-fee',
  feeNotRecordedConfirmed: true,
  payments: [2000000, 1500000, 1000000, 815000].map((amountCents, i) => ({
    qbPaymentId: `PAY-${String.fromCharCode(65 + i)}`,
    amountCents,
    inUndepositedFunds: true,
    existingDepositId: null,
    depositStatusReviewed: true,
    statusEvidenceRef: 'qb-payment-list:rows',
  })),
});
describe('UF candidate versus reviewed instructions', () => {
  it('supports actual QB payments 53150 minus3150 =50000 without a journal', () => {
    const w = buildUfWorksheet(uf());
    expect(w.status).toBe('REVIEWED_INSTRUCTIONS');
    expect(w.importEligible).toBe(false);
    expect(w.expectedNetCents).toBe(5000000);
    expect(w.negativeFeeCents).toBe(-315000);
    expect(w.steps.join(' ')).toContain('PAY-A');
  });
  it('ST-only references cannot authorize selecting payments', () => {
    const v = uf();
    delete v.payments;
    const w = buildUfWorksheet(v);
    expect(w.status).toBe('CANDIDATE');
    expect(w.steps.join(' ')).not.toContain('select these existing');
  });
  it.each([
    'deposited',
    'unknown',
    'wrong-total',
    'fee-recorded',
    'unverified-account',
    'wrong-bank-net',
    'missing-bank-source',
  ])('keeps %s as a candidate', (kind) => {
    const v = uf();
    if (kind === 'deposited') v.payments![0].existingDepositId = 'DEP-EXISTING';
    if (kind === 'unknown') v.payments![0].depositStatusReviewed = false;
    if (kind === 'wrong-total') v.payments![0].amountCents += 1;
    if (kind === 'fee-recorded') v.feeNotRecordedConfirmed = false;
    if (kind === 'unverified-account') v.bankAccountVerified = false;
    if (kind === 'wrong-bank-net') v.bankNetCents = 1;
    if (kind === 'missing-bank-source') delete v.bankEvidenceRef;
    expect(buildUfWorksheet(v).status).toBe('CANDIDATE');
  });
  it('still delivers a candidate when bank/date evidence is missing', () => {
    const v = uf();
    v.bankAccount = '';
    v.depositDate = '';
    expect(buildUfWorksheet(v).status).toBe('CANDIDATE');
  });
  it('rejects duplicate payments and malformed dates', () => {
    const v = uf();
    v.payments![1].qbPaymentId = 'PAY-A';
    expect(() => buildUfWorksheet(v)).toThrow();
    v.payments = uf().payments;
    v.depositDate = 'not-a-date';
    expect(() => buildUfWorksheet(v)).toThrow();
  });
});
