import { describe, expect, it } from 'vitest';
import {
  approveProposal,
  buildFeeProposal,
  createTeachingFeeCase,
  exportQbdIif,
  exportQboCsv,
  safeReviewText,
  verifyProposalInLedger,
  type FeeCase,
} from '../../src/export';
import { parseSource } from '../../src/ingestion';
const approved = async () =>
  approveProposal(
    await buildFeeProposal(createTeachingFeeCase()),
    'Reviewer',
    '2026-10-21T09:00:00.000Z',
  );
describe('fee-only accounting export', () => {
  it('creates two balanced fee-only legs, never another bank debit', async () => {
    const p = await approved(),
      qbo = await exportQboCsv(p),
      qbd = await exportQbdIif(p);
    expect(p.lines.map((l) => l.accountId)).toEqual(['FEES', 'CLEARING']);
    expect(qbo.content).toContain('900.00');
    expect(qbo.content).not.toContain('9100.00');
    expect(qbd.content).toContain('\t-900.00\t');
    expect(qbd.content).toContain('\r\n');
    expect(qbo.manifest.status).toBe('EXPORTED_NOT_POSTED');
    expect(qbo.manifest.synthetic_only).toBe(true);
    expect(qbo.fileName).toMatch(/^SYNTHETIC_DO_NOT_IMPORT_/);
    expect(qbd.fileName).toMatch(/^SYNTHETIC_DO_NOT_IMPORT_/);
    expect(qbo.content).toContain('SYNTHETIC TEACHING ONLY - DO NOT IMPORT TO REAL BOOKS.');
    expect(qbd.content).toContain('SYNTHETIC TEACHING ONLY');
    expect(qbd.manifest.compatibility).toBe('BETA_NOT_TARGET_TESTED');
    expect(p.state).toBe('APPROVED');
  });
  it('requires an explicit exact approval', async () => {
    await expect(exportQboCsv(await buildFeeProposal(createTeachingFeeCase()))).rejects.toThrow();
    for (const change of [
      (p: Awaited<ReturnType<typeof approved>>) => {
        p.date = '2026-09-29';
      },
      (p: Awaited<ReturnType<typeof approved>>) => {
        p.lines[0].debitCents++;
      },
      (p: Awaited<ReturnType<typeof approved>>) => {
        p.feeCase.mappingVersion += 'changed';
      },
      (p: Awaited<ReturnType<typeof approved>>) => {
        p.approval!.reviewer = 'Other reviewer';
      },
      (p: Awaited<ReturnType<typeof approved>>) => {
        p.feeCase.sourceFileHashes[0] = '1'.repeat(64);
      },
      (p: Awaited<ReturnType<typeof approved>>) => {
        p.lines[0].account = 'Other fee';
      },
    ]) {
      const p = await approved();
      change(p);
      await expect(exportQboCsv(p)).rejects.toThrow();
    }
  });
  it('blocks unsupported fee-mode, UF, unposted bank, incomplete coverage and duplicate fee', async () => {
    const changes: ((c: FeeCase) => void)[] = [
      (c) => {
        c.feeMode = 'UNKNOWN';
      },
      (c) => {
        c.accounts[1].isUndepositedFunds = true;
      },
      (c) => {
        c.accounts[1].isUndepositedFunds = null;
      },
      (c) => {
        c.accounts[1].type = 'OTHER_CURRENT_LIABILITY';
      },
      (c) => {
        c.accounts[2].exists = false;
      },
      (c) => {
        c.postedGL[2].posted = false;
      },
      (c) => {
        c.ledgerCoverage.confirmed = false;
      },
      (c) => {
        c.ledgerCoverage.accountIds = ['CLEARING'];
      },
      (c) => {
        c.expenseNotRecordedConfirmed = false;
      },
      (c) => {
        c.existingImportStatus = 'PARTIAL';
      },
      (c) => {
        c.confirmedFeeCents = 89999;
      },
      (c) => {
        c.postedGL = c.postedGL.filter((l) => l.accountId !== 'BANK');
      },
    ];
    for (const mutate of changes) {
      const c = createTeachingFeeCase();
      mutate(c);
      await expect(buildFeeProposal(c)).rejects.toThrow();
    }
  });
  it('blocks existing journal ID and economic fee legs', async () => {
    const c = createTeachingFeeCase(),
      p = await buildFeeProposal(c);
    c.existingJournalIds = [p.journalId];
    await expect(buildFeeProposal(c)).rejects.toThrow();
    const already = createTeachingFeeCase();
    already.postedGL.push({
      transactionId: 'FEE',
      journalId: 'OLD-FEE',
      date: '2026-09-30',
      accountId: 'FEES',
      debitCents: 90000,
      creditCents: 0,
      posted: true,
      evidenceRef: 'ledger',
    });
    await expect(buildFeeProposal(already)).rejects.toThrow();
  });
  it('blocks formula text at the serializer boundary, preserves Unicode only for QBO', async () => {
    for (const name of ['=HYPERLINK("bad")', ' @SUM(1)', 'Fees\tInjected', 'Fees\nInjected']) {
      const c = createTeachingFeeCase();
      c.accounts[2].name = name;
      await expect(buildFeeProposal(c)).rejects.toThrow();
    }
    const c = createTeachingFeeCase();
    c.accounts[2].name = '商户手续费';
    const p = await approveProposal(await buildFeeProposal(c), 'Reviewer');
    await expect(exportQboCsv(p)).resolves.toBeTruthy();
    await expect(exportQbdIif(p)).rejects.toThrow('ASCII');
  });
  it('keeps stable journal IDs on repeat download and neutralizes review-only formulas', async () => {
    const p = await approved();
    expect((await exportQboCsv(p)).content).toBe((await exportQboCsv(p)).content);
    expect(safeReviewText('=HYPERLINK("bad")')).toMatch(/^'/);
    expect(safeReviewText(' \t@evil')).toMatch(/^'/);
  });
});

describe('posting verification requires re-imported GL', () => {
  it('requires exact posted journal and reviewed imported account coverage', async () => {
    const p = await approved();
    const text = `Date,Num,Account,Debit,Credit\n09/30/2026,${p.journalId},Merchant Financing Fees,900.00,\n09/30/2026,${p.journalId},ServiceTitan Clearing,,900.00`;
    const r = await parseSource(text, 'QBO', {
      companyId: p.feeCase.companyId,
      bankAccountId: 'BANK',
      companyTimezone: 'America/New_York',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      asOfDate: '2026-09-30',
      currency: 'USD',
      profile: 'synthetic-v1',
      coverageConfirmed: true,
    });
    expect(r.ok).toBe(true);
    expect((await verifyProposalInLedger(p, r.rows, [r.manifest!])).verified).toBe(true);
    expect(
      (await verifyProposalInLedger(p, r.rows, [{ ...r.manifest!, coverage_confirmed: false }]))
        .verified,
    ).toBe(false);
    const changed = structuredClone(r.rows);
    changed[0].debit_cents++;
    expect((await verifyProposalInLedger(p, changed, [r.manifest!])).verified).toBe(false);
    expect((await verifyProposalInLedger(p, [], [r.manifest!])).verified).toBe(false);
  });
});
