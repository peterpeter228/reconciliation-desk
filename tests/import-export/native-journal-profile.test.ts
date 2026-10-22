import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FeeProposal } from '../../src/export';
import {
  matchProposalJournalPosting,
  verifyProposalInLedger,
  buildFeeProposal,
  approveProposal,
  FEE_ONLY_RULE_VERSION,
} from '../../src/export';
import { parseSource, sha256, type ParseOptions } from '../../src/ingestion';

const directory = new URL('../../evidence/quickbooks-acceptance-20261021/', import.meta.url);
const bytes = new Uint8Array(
  readFileSync(new URL('target-transaction-journal-145.csv', directory)),
);
const csv = new TextDecoder().decode(bytes);
const historicalProposal = JSON.parse(
  readFileSync(new URL('target-synthetic-proposal.json', directory), 'utf8'),
) as FeeProposal;
// Test-only current-rule reapproval. The historical approval/evidence is untouched
// and remains invalid for new exports after a rule change.
const proposal = await approveProposal(
  await buildFeeProposal({
    ...historicalProposal.feeCase,
    ruleVersion: FEE_ONLY_RULE_VERSION,
  }),
  'Synthetic current-rule test reviewer',
  '2026-10-22T06:00:00Z',
);
const options: ParseOptions = {
  companyId: proposal.feeCase.companyId,
  bankAccountId: 'BANK',
  companyTimezone: 'Etc/UTC',
  currency: 'USD',
  periodStart: '2026-09-30',
  periodEnd: '2026-09-30',
  asOfDate: '2026-10-21',
  profile: 'qbo-transaction-journal-v1',
  qboTransactionJournalCompanyName: "Craig's Design and Landscaping Services",
  dateFormat: 'MDY',
  postedLedgerConfirmed: true,
};

describe('untouched native public-sample report integration', () => {
  it('matches the same journal after explicit synthetic reapproval without inventing coverage', async () => {
    const parsed = await parseSource(csv, 'QBO', { ...options, originalBytes: bytes });
    expect(parsed.ok).toBe(true);
    expect(parsed.manifest?.source_file_sha256).toBe(await sha256(bytes));
    expect(parsed.rows.map((r) => r.transaction_id)).toEqual(['145', '145']);
    expect(
      parsed.rows.every(
        (r) => r.line_id === null && r.source_refs[0].column_indices.transaction_id === undefined,
      ),
    ).toBe(true);
    expect(parsed.rows.map((r) => r.source_refs[0].physical_row)).toEqual([7, 8]);
    expect(
      parsed.rows.every(
        (r) => r.source_refs[0].transaction_id_derivation?.group_physical_row === 6,
      ),
    ).toBe(true);
    const result = await matchProposalJournalPosting(proposal, parsed.rows, [parsed.manifest!]);
    expect(result).toMatchObject({
      matched: true,
      transactionId: '145',
      scope: 'EXACT_JOURNAL_POSTING_ONLY',
      periodReconciliationVerified: false,
      clearingBalanceVerified: false,
    });
    expect((await verifyProposalInLedger(proposal, parsed.rows, [parsed.manifest!])).verified).toBe(
      false,
    );
  });
  it('keeps manual mode fail-closed rather than automatically selecting native semantics', async () => {
    const parsed = await parseSource(csv, 'QBO', {
      ...options,
      profile: 'manual',
      bindings: { account_full_name: 6 },
      headerRow: 5,
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.rows).toEqual([]);
  });
  it('tracks physical lines through a quoted multiline description, without changing raw hashes', async () => {
    const oneMemo = proposal.lines[0].memo;
    const withMultiline = csv.replace(oneMemo, `"${oneMemo}\nSynthetic continuation"`);
    const parsed = await parseSource(withMultiline, 'QBO', options);
    expect(parsed.ok).toBe(true);
    expect(parsed.rows.map((r) => r.source_refs[0].physical_row)).toEqual([7, 9]);
    expect(parsed.rows[0].source_refs[0].transaction_id_derivation?.group_total_physical_row).toBe(
      10,
    );
    expect(
      (await matchProposalJournalPosting(proposal, parsed.rows, [parsed.manifest!])).matched,
    ).toBe(false);
  });
});
