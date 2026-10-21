import { describe, expect, it } from 'vitest';
import type { ImportManifest, QB_Ledger_Entry } from '../../contracts/canonical';
import { matchProposalJournalPosting, verifyProposalInLedger } from '../../src/export';
import { parseSource } from '../../src/ingestion';
import { nativeCsv, nativeProposal, options, secondGroup, syntheticCsv } from './fixtures';

async function imported(text = nativeCsv) {
  const parsed = await parseSource(text, 'QBO', options);
  expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
  expect(parsed.manifest).not.toBe(null);
  return { rows: parsed.rows, manifest: parsed.manifest! };
}
async function assertNoMatch(rows: QB_Ledger_Entry[], manifests: ImportManifest[]) {
  const result = await matchProposalJournalPosting(nativeProposal, rows, manifests);
  expect(result.matched, result.reason).toBe(false);
  expect(result.periodReconciliationVerified).toBe(false);
  expect(result.clearingBalanceVerified).toBe(false);
}
type Mutation = [string, (rows: QB_Ledger_Entry[], manifest: ImportManifest) => void];

describe('native exact posting scope never implies month-end or balance reconciliation', () => {
  it('matches only the two exact approved posting legs and reports the narrower scope', async () => {
    const { rows, manifest } = await imported();
    const result = await matchProposalJournalPosting(nativeProposal, rows, [manifest]);
    expect(result).toMatchObject({
      matched: true,
      scope: 'EXACT_JOURNAL_POSTING_ONLY',
      periodReconciliationVerified: false,
      clearingBalanceVerified: false,
      transactionId: '145',
      matchingRowIds: rows.map((row) => row.id),
    });
    expect((await verifyProposalInLedger(nativeProposal, rows, [manifest])).verified).toBe(false);
  });

  it('refuses promotion to legacy full-ledger verification even after a coverage flag is edited', async () => {
    const { rows, manifest } = await imported();
    manifest.coverage_confirmed = true;
    expect((await verifyProposalInLedger(nativeProposal, rows, [manifest])).verified).toBe(false);
    delete manifest.qbo_transaction_journal;
    expect((await verifyProposalInLedger(nativeProposal, rows, [manifest])).verified).toBe(false);
    for (const row of rows) delete row.source_refs[0].transaction_id_derivation;
    expect((await verifyProposalInLedger(nativeProposal, rows, [manifest])).verified).toBe(false);
  });

  it('does not import the teaching receipt/deposit assumptions as actual target transactions', async () => {
    const { rows, manifest } = await imported();
    expect(rows.map((row) => row.transaction_id)).toEqual(['145', '145']);
    expect(rows.some((row) => row.transaction_id === 'DEMO-RECEIPT')).toBe(false);
    expect(rows.some((row) => row.transaction_id === 'DEMO-DEPOSIT')).toBe(false);
    expect(
      manifest.account_balances.every(
        (balance) =>
          balance.opening_debit_balance_cents === null &&
          balance.closing_debit_balance_cents === null &&
          !balance.coverage_confirmed,
      ),
    ).toBe(true);
    expect(
      rows
        .filter((row) => row.account_full_name === 'Uncategorized Asset')
        .reduce((total, row) => total + row.signed_cents, 0),
    ).toBe(-90_000);
  });

  it('still enforces immutable approval at the narrow matching boundary', async () => {
    const { rows, manifest } = await imported();
    const altered = structuredClone(nativeProposal);
    altered.lines[0].memo += ' changed after approval';
    await expect(matchProposalJournalPosting(altered, rows, [manifest])).rejects.toThrow(
      /changed|Approval invalidated|reapprove/i,
    );
  });
});

describe('synthetic multi-group held-out controls, not native compatibility claims', () => {
  it('matches the exact target in a fully controlled multi-group report', async () => {
    const { rows, manifest } = await imported(syntheticCsv((r) => secondGroup(r)));
    const result = await matchProposalJournalPosting(nativeProposal, rows, [manifest]);
    expect(result.matched, result.reason).toBe(true);
    expect(result.transactionId).toBe('145');
    expect(result.matchingRowIds).toEqual(rows.slice(0, 2).map((row) => row.id));
    expect(result.periodReconciliationVerified).toBe(false);
  });

  it('refuses distinct transaction IDs that reuse the approved journal Num', async () => {
    const { rows, manifest } = await imported(
      syntheticCsv((r) => secondGroup(r, '981', nativeProposal.journalId)),
    );
    expect(new Set(rows.map((row) => row.transaction_id)).size).toBe(2);
    await assertNoMatch(rows, [manifest]);
  });

  it('does not ignore balanced extra legs inside the matching transaction', async () => {
    const { rows, manifest } = await imported(
      syntheticCsv((r) => {
        const debit = [...r[6]];
        const credit = [...r[7]];
        debit[6] = 'Synthetic Other Expense';
        credit[6] = 'Synthetic Other Asset';
        debit[7] = '1.00';
        credit[8] = '1.00';
        r.splice(8, 0, debit, credit);
        r[10][7] = r[10][8] = '$901.00';
        r[11][7] = r[11][8] = '$901.00';
      }),
    );
    expect(rows).toHaveLength(4);
    await assertNoMatch(rows, [manifest]);
  });

  it('cannot hide an unrelated group after parsing a complete report', async () => {
    const { rows, manifest } = await imported(syntheticCsv((r) => secondGroup(r)));
    await assertNoMatch(rows.slice(0, 2), [manifest]);
  });

  it('does not verify without the source manifest', async () => {
    const { rows } = await imported();
    await assertNoMatch(rows, []);
  });
});

describe('direct-call provenance and runtime tamper boundaries', () => {
  const mutations: Mutation[] = [
    [
      'a removed posting leg',
      (rows) => {
        rows.pop();
      },
    ],
    [
      'a duplicate posting leg',
      (rows) => {
        rows.push(structuredClone(rows[0]));
      },
    ],
    [
      'an added blank-Num same-transaction leg',
      (rows) => {
        const extra = structuredClone(rows[0]);
        extra.id = 'ADDED';
        extra.num = null;
        extra.source_refs[0].physical_row = 99;
        rows.push(extra);
      },
    ],
    [
      'changed transaction ID',
      (rows) => {
        rows[0].transaction_id = '146';
      },
    ],
    [
      'missing transaction ID',
      (rows) => {
        rows[0].transaction_id = null;
      },
    ],
    [
      'changed journal Num',
      (rows) => {
        rows[0].num = 'OTHER';
      },
    ],
    [
      'changed company namespace',
      (rows) => {
        rows[0].company_id = 'OTHER';
      },
    ],
    [
      'changed accounting product',
      (rows) => {
        rows[0].qb_product = 'QBD';
      },
    ],
    [
      'a mixed-company row with the same source file',
      (rows) => {
        const extra = structuredClone(rows[0]);
        extra.id = 'OTHER-COMPANY';
        extra.company_id = 'OTHER';
        rows.push(extra);
      },
    ],
    [
      'changed memo after parsing',
      (rows) => {
        rows[0].memo_local = 'ALTERED';
      },
    ],
    [
      'changed amount after parsing',
      (rows) => {
        rows[0].debit_cents++;
        rows[0].signed_cents++;
      },
    ],
    [
      'changed date after parsing',
      (rows) => {
        rows[0].posting_date = '2026-09-29';
      },
    ],
    [
      'invalid currency',
      (rows) => {
        Object.assign(rows[0], { currency: 'EUR' });
      },
    ],
    [
      'validation errors',
      (rows) => {
        rows[0].validation_errors = ['INVALID'];
      },
    ],
    [
      'fractional amount',
      (rows) => {
        rows[0].debit_cents = 90_000.5;
      },
    ],
    [
      'non-posted row',
      (rows) => {
        rows[0].is_posted_ledger = false;
      },
    ],
    [
      'changed physical posting row',
      (rows) => {
        rows[0].source_refs[0].physical_row = 8;
      },
    ],
    [
      'changed raw posting hash',
      (rows) => {
        rows[0].source_refs[0].raw_row_sha256 = '0'.repeat(64);
      },
    ],
    [
      'changed source hash',
      (rows) => {
        rows[0].source_refs[0].file_sha256 = '0'.repeat(64);
      },
    ],
    [
      'changed mapping version',
      (rows) => {
        rows[0].source_refs[0].mapping_version = 'manual';
      },
    ],
    [
      'changed parser version',
      (rows) => {
        rows[0].source_refs[0].parser_version = 'other';
      },
    ],
    [
      'removed derivation proof',
      (rows) => {
        delete rows[0].source_refs[0].transaction_id_derivation;
      },
    ],
    [
      'changed derivation ID',
      (rows) => {
        rows[0].source_refs[0].transaction_id_derivation!.transaction_id = '146';
      },
    ],
    [
      'changed group locator',
      (rows) => {
        rows[0].source_refs[0].transaction_id_derivation!.group_physical_row = 7;
      },
    ],
    [
      'changed group hash',
      (rows) => {
        rows[0].source_refs[0].transaction_id_derivation!.group_raw_row_sha256 = '0'.repeat(64);
      },
    ],
    [
      'changed group total locator',
      (rows) => {
        rows[0].source_refs[0].transaction_id_derivation!.group_total_physical_row = 10;
      },
    ],
    [
      'changed group total hash',
      (rows) => {
        rows[0].source_refs[0].transaction_id_derivation!.group_total_raw_row_sha256 = '0'.repeat(
          64,
        );
      },
    ],
    [
      'unsupported derivation profile',
      (rows) => {
        Object.assign(rows[0].source_refs[0].transaction_id_derivation!, {
          profile_version: 'qbo-transaction-journal-v999',
        });
      },
    ],
    [
      'removed manifest report proof',
      (_, manifest) => {
        delete manifest.qbo_transaction_journal;
      },
    ],
    [
      'empty manifest groups',
      (_, manifest) => {
        manifest.qbo_transaction_journal!.groups = [];
      },
    ],
    [
      'changed manifest group identity',
      (_, manifest) => {
        manifest.qbo_transaction_journal!.groups[0].transaction_id = '146';
      },
    ],
    [
      'changed manifest group posting membership',
      (_, manifest) => {
        manifest.qbo_transaction_journal!.groups[0].posting_physical_rows = [7];
      },
    ],
    [
      'changed manifest row count',
      (_, manifest) => {
        manifest.normalized_row_count = 1;
      },
    ],
    [
      'changed manifest company',
      (_, manifest) => {
        manifest.company_id = 'OTHER';
      },
    ],
    [
      'changed manifest source hash',
      (_, manifest) => {
        manifest.source_file_sha256 = '0'.repeat(64);
      },
    ],
    [
      'changed manifest coverage',
      (_, manifest) => {
        manifest.coverage_confirmed = true;
      },
    ],
    [
      'invented manifest opening balance',
      (_, manifest) => {
        manifest.account_balances[0].opening_debit_balance_cents = 90_000;
      },
    ],
    [
      'changed manifest observed company label',
      (_, manifest) => {
        manifest.qbo_transaction_journal!.report_company_name = 'OTHER';
      },
    ],
    [
      'changed manifest footer hash',
      (_, manifest) => {
        manifest.qbo_transaction_journal!.footer_raw_row_sha256 = '0'.repeat(64);
      },
    ],
    [
      'changed manifest report scope',
      (_, manifest) => {
        Object.assign(manifest.qbo_transaction_journal!, { scope: 'COMPLETE_PERIOD' });
      },
    ],
    [
      'changed manifest report digest',
      (_, manifest) => {
        manifest.qbo_transaction_journal!.manifest_payload_sha256 = '0'.repeat(64);
      },
    ],
    [
      'changed manifest row digest',
      (_, manifest) => {
        manifest.qbo_transaction_journal!.normalized_rows_sha256 = '0'.repeat(64);
      },
    ],
  ];
  it.each(mutations)('rejects %s', async (_, mutation) => {
    const { rows, manifest } = await imported();
    mutation(rows, manifest);
    await assertNoMatch(rows, [manifest]);
  });
});

// These deliberately recompute ordinary SHA-256 change-detection digests. A hash
// is not source authentication; runtime structural constraints must still apply.
describe('independent invariants survive a recomputed evidence digest', () => {
  const mutations: Mutation[] = [
    [
      'posting overlaps group header',
      (rows, manifest) => {
        const group = manifest.qbo_transaction_journal!.groups[0];
        group.group_physical_row = 7;
        rows.forEach((row) => {
          row.source_refs[0].transaction_id_derivation!.group_physical_row = 7;
        });
      },
    ],
    [
      'posting overlaps closing control',
      (rows, manifest) => {
        const group = manifest.qbo_transaction_journal!.groups[0];
        group.total_physical_row = 8;
        rows.forEach((row) => {
          row.source_refs[0].transaction_id_derivation!.group_total_physical_row = 8;
        });
      },
    ],
    [
      'Num is misrepresented as a direct identity column',
      (rows) => {
        rows.forEach((row) => {
          row.source_refs[0].column_indices.transaction_id = [3];
        });
      },
    ],
    [
      'group total is self-consistently changed but posting cents are not',
      (_, manifest) => {
        manifest.qbo_transaction_journal!.groups[0].debit_cents = 91_000;
        manifest.qbo_transaction_journal!.groups[0].credit_cents = 91_000;
      },
    ],
    [
      'invented account inventory',
      (_, manifest) => {
        manifest.accounts.push('Invented Account');
        manifest.account_balances.push({
          account_id: null,
          account_full_name: 'Invented Account',
          opening_debit_balance_cents: null,
          closing_debit_balance_cents: null,
          coverage_confirmed: false,
        });
      },
    ],
    [
      'footer before grand total',
      (_, manifest) => {
        manifest.qbo_transaction_journal!.footer_physical_row = 9;
      },
    ],
    [
      'extra same-company row absent from group membership',
      (rows, manifest) => {
        const extra = structuredClone(rows[0]);
        extra.id = '1'.repeat(64);
        extra.transaction_id = '981';
        extra.num = 'OTHER';
        extra.source_refs[0].physical_row = 15;
        rows.push(extra);
        manifest.normalized_row_count++;
      },
    ],
  ];
  it.each(mutations)('rejects %s', async (_, mutation) => {
    const { rows, manifest } = await imported();
    mutation(rows, manifest);
    const { canonicalJson, sha256 } = await import('../../src/ingestion/primitives');
    manifest.qbo_transaction_journal!.normalized_rows_sha256 = await sha256(
      canonicalJson(
        [...rows].sort((a, b) => a.source_refs[0].physical_row - b.source_refs[0].physical_row),
      ),
    );
    manifest.qbo_transaction_journal!.manifest_payload_sha256 = '';
    manifest.qbo_transaction_journal!.manifest_payload_sha256 = await sha256(
      canonicalJson(manifest),
    );
    await assertNoMatch(rows, [manifest]);
  });
});

describe('held-out synthetic proposals with varied amounts and IDs', () => {
  it.each([1, 17, 12_345, 987_654])(
    'matches %i cents without native-sample amount assumptions',
    async (feeCents) => {
      const { approveProposal, buildFeeProposal } = await import('../../src/export');
      const { formatCents } = await import('../../src/ingestion/primitives');
      const feeCase = structuredClone(nativeProposal.feeCase);
      feeCase.caseId = `SYNTHETIC_HELDOUT_${feeCents}`;
      feeCase.grossCents = feeCase.bankNetCents + feeCents;
      feeCase.confirmedFeeCents = feeCase.clearingResidualCents = feeCents;
      feeCase.postedGL[0].debitCents = feeCase.grossCents;
      feeCase.postedGL[1].creditCents = feeCase.grossCents;
      const proposal = await approveProposal(
        await buildFeeProposal(feeCase),
        'Synthetic Test Reviewer',
      );
      const groupId = '90071992547409931234'; // ID is text, never a JS number.
      const text = syntheticCsv((r) => {
        r[5][0] = groupId;
        r[6][3] = r[7][3] = proposal.journalId;
        r[6][5] = proposal.lines[0].memo;
        r[7][5] = proposal.lines[1].memo;
        r[6][7] = r[7][8] = formatCents(feeCents);
        r[8][0] = `Total for ${groupId}`;
        r[8][7] = r[8][8] = r[9][7] = r[9][8] = `$${formatCents(feeCents)}`;
      });
      const { rows, manifest } = await imported(text);
      expect(rows.map((row) => row.transaction_id)).toEqual([groupId, groupId]);
      const result = await matchProposalJournalPosting(proposal, rows, [manifest]);
      expect(result.matched, result.reason).toBe(true);
      expect(result.transactionId).toBe(groupId);
      expect(result.clearingBalanceVerified).toBe(false);
    },
  );
});
