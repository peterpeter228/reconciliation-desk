import { describe, it, expect } from 'vitest';
import { example, payment, ledger, bank } from '../engine/helpers';
import { createTeachingFeeCase } from '../../src/export/aje';
import { reconcile } from '../../src/engine';
import { initialFacts, proposalFromCase } from '../../src/review/case-adapter';
import { initializeReview, reviewForGroup } from '../../src/review/project';
import type { Workspace } from '../../src/components/workspace';
function scenario() {
  const c = createTeachingFeeCase(),
    input = example();
  input.st = [
    payment({
      gross_cents: 1000000,
      reported_net_cents: 910000,
      reported_fee_cents: 90000,
      fee_mode: 'NETTED',
    }),
  ];
  input.bank = [bank({ signed_cents: 910000 })];
  input.qb = c.postedGL.map((l, i) =>
    ledger({
      id: `qb-${i}`,
      transaction_id: l.transactionId,
      line_id: `line-${i}`,
      num: l.journalId,
      posting_date: l.date,
      account_id: l.accountId,
      account_full_name: c.accounts.find((a) => a.id === l.accountId)!.name,
      account_type: c.accounts.find((a) => a.id === l.accountId)!.type,
      debit_cents: l.debitCents,
      credit_cents: l.creditCents,
      signed_cents: l.debitCents - l.creditCents,
      role:
        l.accountId === 'BANK'
          ? 'BANK'
          : l.accountId === 'CLEARING'
            ? l.debitCents
              ? 'CLEARING_RECEIPT'
              : 'CLEARING_SETTLEMENT'
            : 'OTHER',
      linked_deposit_id: l.transactionId === c.settlementTransactionId ? 'd1' : null,
      linked_payment_id: l.transactionId === c.receiptTransactionId ? 'p1' : null,
    }),
  );
  input.config!.qb_bank_account_names = ['Collections Checking'];
  const w: Workspace = {
    input,
    result: reconcile(input),
    duration: 0,
    isDemo: true,
    runId: 'adapter',
    files: input.manifests.map((m) => ({
      name: m.report_name,
      kind: m.source_system,
      hash: m.source_file_sha256,
    })),
    options: {
      companyId: 'company',
      bankAccountId: 'bank',
      companyTimezone: 'America/New_York',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      asOfDate: '2026-09-30',
      currency: 'USD',
    },
  };
  const g = w.result.groups.find((g) => g.st_ids.includes(input.st[0]!.id))!;
  // Current engine may keep a review candidate, but adapter must bind only actual source rows in this candidate.
  g.qb_ids = input.qb.map((x) => x.id);
  g.bank_ids = input.bank.map((x) => x.id);
  g.bank_cents = 910000;
  g.accepted = true;
  g.search_status = 'COMPLETE';
  g.matching_state = 'PARTIAL';
  w.result.controls.conservation_ok = true;
  w.review = initializeReview(w);
  const r = reviewForGroup(w.review, g.id)!;
  const f = {
    ...initialFacts(w),
    reviewedAccounts: c.accounts.map((a) => ({ ...a, id: a.name })),
    reviewer: 'Test accountant',
    notes: 'Synthetic documented net fee, posted receipt and net bank, full reviewed GL.',
    bankAccountName: 'Collections Checking',
    clearingAccountName: 'ServiceTitan Clearing',
    feeAccountName: 'Merchant Financing Fees',
    receiptTransactionId: c.receiptTransactionId,
    settlementTransactionId: c.settlementTransactionId,
    documentedFee: '900.00',
    feeMode: 'NETTED' as const,
    netFeeConfirmed: true,
    periodOpenConfirmed: true,
    expenseNotRecordedConfirmed: true,
    completeLedgerConfirmed: true,
    ledgerCoveredAccountNames: c.accounts.map((a) => a.name).join('\n'),
    ledgerPeriodStart: w.options.periodStart,
    ledgerPeriodEnd: w.options.periodEnd,
    accountsReviewed: true,
    clearingIsOrdinaryAsset: true,
    documents: (
      [
        { purpose: 'COA', name: 'coa.csv', sha256: 'a'.repeat(64), sizeBytes: 100 },
        { purpose: 'SETTLEMENT', name: 'settlement.csv', sha256: 'b'.repeat(64), sizeBytes: 100 },
        { purpose: 'LEDGER', name: 'ledger.csv', sha256: 'c'.repeat(64), sizeBytes: 100 },
      ] as const
    ).map((d) => ({ ...d })),
  };
  return { w, g, r, f };
}
describe('current-case accounting adapter', () => {
  it('builds only expense debit and clearing credit for supported posted gross/net', async () => {
    const { w, g, r, f } = scenario();
    const p = await proposalFromCase(w, g, r, f);
    expect(p.lines.map((l) => [l.account, l.debitCents, l.creditCents])).toEqual([
      ['Merchant Financing Fees', 90000, 0],
      ['ServiceTitan Clearing', 0, 90000],
    ]);
  });
  it('does not infer full expense coverage from COA selection', async () => {
    const { w, g, r, f } = scenario();
    f.ledgerCoveredAccountNames = f.ledgerCoveredAccountNames.replace(
      'Merchant Financing Fees',
      '',
    );
    await expect(proposalFromCase(w, g, r, f)).rejects.toThrow('covered accounts');
  });
  it('blocks bank feed, mixed hold and liability', async () => {
    for (const mode of ['feed', 'hold', 'liability']) {
      const { w, g, r, f } = scenario();
      if (mode === 'feed') w.input.qb.find((l) => l.role === 'BANK')!.is_posted_ledger = false;
      if (mode === 'hold') g.holds_cents = 30000;
      if (mode === 'liability')
        w.input.qb
          .filter((l) => l.account_full_name === f.clearingAccountName)
          .forEach((l) => (l.account_type = 'OTHER_CURRENT_LIABILITY'));
      await expect(proposalFromCase(w, g, r, f)).rejects.toThrow();
    }
  });
  it('blocks unsupported UF and account-type misclassification', async () => {
    const { w, g, r, f } = scenario();
    w.options.accountMap = {
      [f.clearingAccountName]: { accountType: 'OTHER_CURRENT_ASSET', isUndepositedFunds: true },
    };
    await expect(proposalFromCase(w, g, r, f)).rejects.toThrow();
    const s = scenario();
    s.w.input.qb
      .filter((l) => l.account_full_name === s.f.clearingAccountName)
      .forEach((l) => (l.account_type = 'EXPENSE'));
    await expect(proposalFromCase(s.w, s.g, s.r, s.f)).rejects.toThrow();
  });
  it('blocks already exported action even when facts are otherwise sufficient', async () => {
    const { w, g, r, f } = scenario();
    r.existingImportStatus = 'UNKNOWN';
    await expect(proposalFromCase(w, g, r, f)).rejects.toThrow('history');
  });
  it('does not infer documented fee without actual local source references', async () => {
    const { w, g, r, f } = scenario();
    f.documents = [];
    await expect(proposalFromCase(w, g, r, f)).rejects.toThrow('document');
  });
  it('requires unrelated fee evidence, not filtering full GL before validation', async () => {
    const { w, g, r, f } = scenario();
    w.input.qb.push(
      ledger({
        id: 'other-fee',
        transaction_id: 'OTHER-FEE',
        num: 'OTHER-FEE',
        account_full_name: f.feeAccountName,
        account_type: 'EXPENSE',
        role: 'FEE',
        debit_cents: 10000,
        credit_cents: 0,
        signed_cents: 10000,
      }),
    );
    await expect(proposalFromCase(w, g, r, f)).rejects.toThrow();
    f.relations = [
      {
        transactionId: 'OTHER-FEE',
        relation: 'OTHER_CASE',
        relatedCaseId: 'different-economic-case',
        evidenceRef: 'different-settlement:row2',
        reviewer: 'Test accountant',
      },
    ];
    await expect(proposalFromCase(w, g, r, f)).rejects.toThrow('Other-case');
    w.result.groups.push({
      ...g,
      id: 'other-fee-group',
      qb_ids: [w.input.qb.at(-1)!.id],
      st_ids: [],
      bank_ids: [],
    });
    w.review!.cases.push({
      ...r,
      economicCaseId: 'different-economic-case',
      engineGroupId: 'other-fee-group',
      accountingActionId: 'other-action',
      exportHistory: [],
      reviewedFacts: {},
    });
    f.relations[0]!.evidenceRef = f.documents.find((d) => d.purpose === 'LEDGER')!.sha256;
    await expect(proposalFromCase(w, g, r, f)).resolves.toMatchObject({ state: 'DRAFT' });
    f.relations[0]!.relation = 'THIS_CASE';
    f.relations[0]!.relatedCaseId = r.economicCaseId;
    await expect(proposalFromCase(w, g, r, f)).rejects.toThrow();
  });
});
