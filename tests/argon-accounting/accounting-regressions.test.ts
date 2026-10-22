import { describe, expect, it } from 'vitest';
import {
  approveProposal,
  buildFeeProposal,
  createTeachingFeeCase,
  exportQboCsv,
  verifyProposalInLedger,
  type FeeCase,
} from '../../src/export';
import { parseSource, type ParseOptions } from '../../src/ingestion';
import { canonicalJson, sha256 } from '../../src/ingestion/primitives';
import { syntheticMappingPreview } from '../../src/mapping/redact';

const options: ParseOptions = {
  companyId: 'SYNTHETIC_TEACHING_ONLY',
  bankAccountId: 'BANK',
  companyTimezone: 'America/New_York',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  asOfDate: '2026-09-30',
  currency: 'USD',
  profile: 'synthetic-v1',
  coverageConfirmed: true,
};

async function approvedJournal() {
  return approveProposal(await buildFeeProposal(createTeachingFeeCase()), 'Synthetic Reviewer');
}

async function importedJournal(transactionIds = ['POSTED-JE', 'POSTED-JE'], extra = '') {
  const proposal = await approvedJournal();
  const imported = await parseSource(
    `Transaction ID,Line ID,Date,Num,Account,Debit,Credit\n` +
      `${transactionIds[0]},1,09/30/2026,${proposal.journalId},Merchant Financing Fees,900.00,\n` +
      `${transactionIds[1]},2,09/30/2026,${proposal.journalId},ServiceTitan Clearing,,900.00` +
      extra,
    'QBO',
    options,
  );
  expect(imported.ok).toBe(true);
  return { proposal, imported };
}

describe('Argon P1-2: re-import must verify one complete journal', () => {
  it('accepts the exact two posted legs with one shared transaction identity', async () => {
    const { proposal, imported } = await importedJournal();
    expect(
      (await verifyProposalInLedger(proposal, imported.rows, [imported.manifest!])).verified,
    ).toBe(true);
  });

  it('does not combine two transactions that reused the same journal number', async () => {
    const { proposal, imported } = await importedJournal(['TX-1', 'TX-2']);
    expect(
      (await verifyProposalInLedger(proposal, imported.rows, [imported.manifest!])).verified,
    ).toBe(false);
  });

  it('does not silently combine an identified and an unidentified transaction', async () => {
    const { proposal, imported } = await importedJournal(['TX-1', '']);
    expect(
      (await verifyProposalInLedger(proposal, imported.rows, [imported.manifest!])).verified,
    ).toBe(false);
  });

  it('keeps identifier-free GL importable but cannot verify journal identity from DocNum alone', async () => {
    const { proposal, imported } = await importedJournal(['', '']);
    const result = await verifyProposalInLedger(proposal, imported.rows, [imported.manifest!]);
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/transaction identity|Transaction ID/i);
  });

  it('rejects additional same-transaction legs whose journal numbers are blank', async () => {
    const { proposal, imported } = await importedJournal(
      undefined,
      '\nPOSTED-JE,3,09/30/2026,,Other Expense,10.00,\nPOSTED-JE,4,09/30/2026,,Other Asset,,10.00',
    );
    expect(
      (await verifyProposalInLedger(proposal, imported.rows, [imported.manifest!])).verified,
    ).toBe(false);
  });

  it('does not merge QBO and QBD transaction identities', async () => {
    const { proposal, imported } = await importedJournal();
    imported.rows[1].qb_product = 'QBD';
    expect(
      (await verifyProposalInLedger(proposal, imported.rows, [imported.manifest!])).verified,
    ).toBe(false);
  });

  it('keeps same-ID rows in other companies outside this company journal', async () => {
    const { proposal, imported } = await importedJournal();
    const other = structuredClone(imported.rows[0]);
    other.company_id = 'ANOTHER_SYNTHETIC_COMPANY';
    other.id = 'another-company-line';
    other.num = null;
    expect(
      (await verifyProposalInLedger(proposal, [...imported.rows, other], [imported.manifest!]))
        .verified,
    ).toBe(true);
  });

  it('still requires source-hash coverage and immutable approval', async () => {
    const { proposal, imported } = await importedJournal();
    const wrongSource = { ...imported.manifest!, source_file_sha256: '0'.repeat(64) };
    expect((await verifyProposalInLedger(proposal, imported.rows, [wrongSource])).verified).toBe(
      false,
    );
    proposal.feeCase.sourceFileHashes[0] = '1'.repeat(64);
    await expect(
      verifyProposalInLedger(proposal, imported.rows, [imported.manifest!]),
    ).rejects.toThrow('Approval invalidated');
  });
});

function addLeg(
  c: FeeCase,
  transactionId: string,
  accountId: string,
  debitCents: number,
  creditCents: number,
) {
  c.postedGL.push({
    transactionId,
    journalId: transactionId,
    date: '2026-09-03',
    accountId,
    debitCents,
    creditCents,
    posted: true,
    evidenceRef: 'synthetic-adversarial-evidence',
  });
}

describe('Parent follow-on: direct verification boundary validates runtime input', () => {
  it.each([
    ['non-USD currency', { currency: 'EUR' }],
    ['prior validation errors', { validation_errors: ['UNREVIEWED_INPUT'] }],
    ['missing validation status', { validation_errors: undefined }],
    ['inconsistent signed amount', { signed_cents: -90_000 }],
    ['fractional debit', { debit_cents: 90_000.5 }],
    ['negative debit', { debit_cents: -90_000 }],
    ['unsafe debit', { debit_cents: Number.MAX_SAFE_INTEGER + 1 }],
    ['nonfinite signed amount', { signed_cents: Number.NaN }],
    ['truthy nonboolean posted flag', { is_posted_ledger: 'true' }],
  ])('rejects %s even if the TypeScript contract is bypassed', async (_, invalid) => {
    const { proposal, imported } = await importedJournal();
    Object.assign(imported.rows[0], invalid);
    expect(
      (await verifyProposalInLedger(proposal, imported.rows, [imported.manifest!])).verified,
    ).toBe(false);
  });

  it('does not accept an unsupported product even with a matching manifest label', async () => {
    const { proposal, imported } = await importedJournal();
    for (const row of imported.rows) Object.assign(row, { qb_product: 'OTHER' });
    Object.assign(imported.manifest!, { source_system: 'OTHER' });
    expect(
      (await verifyProposalInLedger(proposal, imported.rows, [imported.manifest!])).verified,
    ).toBe(false);
  });

  it.each([
    ['invalid physical row', { physical_row: 0 }],
    ['invalid raw row hash', { raw_row_sha256: 'not-a-hash' }],
    ['missing parser version', { parser_version: '' }],
    ['missing mapping version', { mapping_version: '' }],
    ['invalid column locator', { column_indices: { posting_date: [-1] } }],
  ])('rejects provenance with %s', async (_, invalid) => {
    const { proposal, imported } = await importedJournal();
    Object.assign(imported.rows[0].source_refs[0], invalid);
    expect(
      (await verifyProposalInLedger(proposal, imported.rows, [imported.manifest!])).verified,
    ).toBe(false);
  });

  it('requires valid source-file hashes even if an invalid value matches the manifest', async () => {
    const { proposal, imported } = await importedJournal();
    for (const row of imported.rows) row.source_refs[0].file_sha256 = 'not-a-hash';
    imported.manifest!.source_file_sha256 = 'not-a-hash';
    expect(
      (await verifyProposalInLedger(proposal, imported.rows, [imported.manifest!])).verified,
    ).toBe(false);
  });
});

describe('Parent release hardening: approval must use the active fee rule', () => {
  it.each(['fee-only-1.0', 'fee-only-unknown'])(
    'rejects unsupported fee rule version %s',
    async (ruleVersion) => {
      const feeCase = createTeachingFeeCase();
      feeCase.ruleVersion = ruleVersion;
      await expect(buildFeeProposal(feeCase)).rejects.toThrow(/rule version/i);
    },
  );

  it('invalidates a self-consistent old-version approval, not merely a changed hash', async () => {
    const proposal = await approvedJournal();
    proposal.feeCase.ruleVersion = 'fee-only-1.0';
    proposal.approval!.payloadHash = await sha256(
      canonicalJson({
        ...proposal,
        approval: { ...proposal.approval!, payloadHash: '' },
      }),
    );
    await expect(exportQboCsv(proposal)).rejects.toThrow(/rule version/i);
  });
});

describe('Parent follow-on: manifest coverage must also be runtime-valid', () => {
  it.each([
    ['truthy false coverage', { coverage_confirmed: 'false' }],
    ['malformed period start', { period_start: '0000' }],
    ['malformed period end', { period_end: '9999' }],
    ['malformed as-of date', { as_of_date: 'not-a-date' }],
    ['as-of date before reviewed period end', { as_of_date: '2026-09-01' }],
    ['unresolved required fields', { missing_required_fields: ['posting_date'] }],
    [
      'account names supplied as a string',
      { accounts: 'Merchant Financing Fees,ServiceTitan Clearing' },
    ],
  ])('rejects %s as verification coverage', async (_, invalid) => {
    const { proposal, imported } = await importedJournal();
    Object.assign(imported.manifest!, invalid);
    expect(
      (await verifyProposalInLedger(proposal, imported.rows, [imported.manifest!])).verified,
    ).toBe(false);
  });
});

describe('Argon P1-3: case footprint is distinct from full-ledger coverage', () => {
  it('already rejects the original proposed offsetting-clearing bypass', async () => {
    const c = createTeachingFeeCase();
    addLeg(c, c.settlementTransactionId, 'AR', 90_000, 0);
    addLeg(c, c.settlementTransactionId, 'CLEARING', 0, 90_000);
    addLeg(c, 'OTHER-TX', 'CLEARING', 90_000, 0);
    addLeg(c, 'OTHER-TX', 'AR', 0, 90_000);
    await expect(buildFeeProposal(c)).rejects.toThrow();
  });

  it('rejects an unrelated balanced compound posting embedded in the settlement', async () => {
    const c = createTeachingFeeCase();
    c.accounts.push({
      id: 'OTHER_EXPENSE',
      name: 'Other Expense',
      type: 'EXPENSE',
      exists: true,
      isUndepositedFunds: false,
    });
    addLeg(c, c.settlementTransactionId, 'OTHER_EXPENSE', 50_000, 0);
    addLeg(c, c.settlementTransactionId, 'AR', 0, 50_000);
    await expect(buildFeeProposal(c)).rejects.toThrow();
  });

  it('rejects offsetting extra clearing movements within the settlement', async () => {
    const c = createTeachingFeeCase();
    addLeg(c, c.settlementTransactionId, 'CLEARING', 50_000, 0);
    addLeg(c, c.settlementTransactionId, 'CLEARING', 0, 50_000);
    await expect(buildFeeProposal(c)).rejects.toThrow();
  });

  it('does not confuse unrelated full-ledger clearing activity with this case residual', async () => {
    const c = createTeachingFeeCase();
    addLeg(c, 'OTHER-RECEIPT', 'CLEARING', 123_456, 0);
    addLeg(c, 'OTHER-RECEIPT', 'AR', 0, 123_456);
    c.postedGLRelations = [
      {
        transactionId: 'OTHER-RECEIPT',
        relation: 'OTHER_CASE',
        relatedCaseId: 'OTHER-CASE',
        evidenceRef: 'other-receipt-link',
        reviewer: 'Synthetic Reviewer',
      },
    ];
    const proposal = await buildFeeProposal(c);
    expect(proposal.lines.map((line) => line.debitCents - line.creditCents)).toEqual([
      90_000, -90_000,
    ]);
    expect(proposal.feeCase.postedGL).toHaveLength(6);
    const approved = await approveProposal(proposal, 'Synthetic Reviewer');
    approved.feeCase.postedGL[4].evidenceRef = 'changed-evidence';
    await expect(exportQboCsv(approved)).rejects.toThrow('Approval invalidated');
  });

  it('allows the same narrow settlement split across multiple same-account posting lines', async () => {
    const c = createTeachingFeeCase();
    c.postedGL[2].debitCents = 500_000;
    addLeg(c, c.settlementTransactionId, 'BANK', 410_000, 0);
    await expect(buildFeeProposal(c)).resolves.toMatchObject({ state: 'DRAFT' });
  });

  it('keeps full-ledger duplicate fee evidence as a blocking review requirement', async () => {
    const c = createTeachingFeeCase();
    addLeg(c, 'POSSIBLE-EXISTING-FEE', 'FEES', 90_000, 0);
    addLeg(c, 'POSSIBLE-EXISTING-FEE', 'CLEARING', 0, 90_000);
    await expect(buildFeeProposal(c)).rejects.toThrow('fee entry is already present');
  });
});

describe('Argon plausible CSV summary false positive', () => {
  it.each([
    'Total Comfort Heating & Air',
    'Total Plumbing LLC',
    'Subtotal Services',
    'Opening Balance Repairs',
  ])(
    'preserves a real customer named %s with valid payment identity and date',
    async (customer) => {
      const text = `Customer Name,Payment ID,Payment Date,Payment Amount\n${customer},PAY-1,09/01/2026,123.45`;
      const imported = await parseSource(text, 'ST', options);
      expect(imported.ok).toBe(true);
      expect(imported.rows).toHaveLength(1);
      expect(imported.controls.signedCents).toBe(12_345);
      expect(imported.manifest?.excluded_summary_rows).toEqual([]);
      expect(imported.rows[0].source_refs[0].physical_row).toBe(2);
      expect(imported.rows[0].source_refs[0].file_sha256).toBe(await sha256(text));
      expect(imported.rows[0].source_refs[0].raw_row_sha256).toBe(
        await sha256(text.split('\n')[1]),
      );
    },
  );

  it('preserves description-first bank rows without requiring transaction IDs', async () => {
    const imported = await parseSource(
      'Description,Posting Date,Amount\nTotal Comfort Heating & Air,09/01/2026,123.45',
      'BANK',
      options,
    );
    expect(imported.ok).toBe(true);
    expect(imported.rows).toHaveLength(1);
  });

  it.each(['TOTAL', 'TOTAL FOR Checking'])(
    'keeps a summary-like description %s when an independent posting date exists',
    async (description) => {
      const imported = await parseSource(
        `Description,Posting Date,Amount\n${description},09/01/2026,123.45`,
        'BANK',
        options,
      );
      expect(imported.ok).toBe(true);
      expect(imported.rows).toHaveLength(1);
      expect(imported.controls.excludedRows).toEqual([]);
    },
  );

  it.each(['TOTAL', 'SUBTOTAL', 'TOTAL FOR Checking', 'BEGINNING BALANCE', 'ENDING BALANCE'])(
    'preserves genuine summary marker %s as auditable excluded control rows',
    async (label) => {
      const imported = await parseSource(
        `Description,Posting Date,Amount\nCustomer,09/01/2026,123.45\n${label},,123.45`,
        'BANK',
        options,
      );
      expect(imported.ok).toBe(true);
      expect(imported.rows).toHaveLength(1);
      expect(imported.manifest?.excluded_summary_rows).toEqual([3]);
    },
  );

  it('does not hide an invalid date on a transaction whose customer starts with Total', async () => {
    const imported = await parseSource(
      'Customer Name,Payment ID,Payment Date,Payment Amount\nTotal Comfort Heating & Air,PAY-1,not-a-date,123.45',
      'ST',
      options,
    );
    expect(imported.ok).toBe(false);
    expect(imported.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ROW_INVALID', physicalRow: 2 })]),
    );
    expect(imported.controls.excludedRows).toEqual([]);
  });

  it('does not hide a missing date on an identified transaction named exactly TOTAL', async () => {
    const imported = await parseSource(
      'Customer Name,Payment ID,Payment Date,Payment Amount\nTOTAL,PAY-1,,123.45',
      'ST',
      options,
    );
    expect(imported.ok).toBe(false);
    expect(imported.controls.excludedRows).toEqual([]);
  });
});

describe('Argon P2-3 is type-hint accuracy, not raw-value disclosure', () => {
  it('never includes raw numeric or non-US sample values', () => {
    const values = ['987654321', '9087', '9.876,54', '$9,876.54'];
    const preview = syntheticMappingPreview(
      values.map(() => 'Unknown'),
      [values],
      'ST',
    );
    for (const value of values) expect(JSON.stringify(preview)).not.toContain(value);
  });

  it('does not label ambiguous pure integers or malformed grouping as money', () => {
    const preview = syntheticMappingPreview(
      ['Unknown', 'Unknown', 'Unknown'],
      [['9087', '90210', '1,2']],
      'ST',
    );
    expect(preview.sample_rows).toEqual([['TEXT', 'TEXT', 'TEXT']]);
  });

  it('keeps only synthetic signed US money samples when an explicit monetary cue exists', () => {
    const preview = syntheticMappingPreview(
      ['Amount', 'Amount', 'Amount', 'Amount'],
      [['$9,876.54', '-$87', '($9,876.54)', '12.3']],
      'BANK',
    );
    expect(preview.sample_rows).toEqual([['123.45', '-123.45', '(123.45)', '123.45']]);
  });
});
