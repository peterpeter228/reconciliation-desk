import { describe, expect, it } from 'vitest';
import { parseSource, parseXlsx, sha256, type ParseOptions } from '../../src/ingestion';
import {
  matrix,
  nativeCsv,
  nativeCsvBytes,
  nativeXlsxBytes,
  options,
  secondGroup,
  syntheticCsv,
  syntheticValuesOnlyXlsx,
} from './fixtures';

type Mutation = [string, (rows: string[][]) => void];
async function assertRejected(text: string, overrides: Partial<ParseOptions> = {}) {
  const parsed = await parseSource(text, 'QBO', { ...options, ...overrides });
  expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(false);
  expect(parsed.rows).toEqual([]);
  expect(parsed.issues.some((issue) => issue.severity === 'error')).toBe(true);
}

describe('untouched public-demo evidence: narrow CSV success and honest XLSX blocker', () => {
  it('preserves exact bytes, physical posting rows and group identity without rewriting input', async () => {
    expect(await sha256(nativeCsvBytes)).toBe(
      'd8e334975acbc74cc7a0b7b9f157f8f3f39f67f18bd85769deefceec5d690234',
    );
    const parsed = await parseSource(nativeCsv, 'QBO', {
      ...options,
      originalBytes: nativeCsvBytes,
    });
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows.map((row) => row.transaction_id)).toEqual(['145', '145']);
    expect(parsed.rows.map((row) => row.num)).toEqual(['RDCE641C900E', 'RDCE641C900E']);
    expect(parsed.rows.map((row) => row.source_refs[0].physical_row)).toEqual([7, 8]);
    expect(parsed.rows.map((row) => [row.debit_cents, row.credit_cents])).toEqual([
      [90_000, 0],
      [0, 90_000],
    ]);
    for (const row of parsed.rows) {
      const ref = row.source_refs[0];
      expect(ref.transaction_id_derivation).toEqual({
        kind: 'QBO_TRANSACTION_JOURNAL_GROUP',
        profile_version: 'qbo-transaction-journal-v1',
        transaction_id: '145',
        group_physical_row: 6,
        group_column_index: 0,
        group_raw_row_sha256: await sha256(nativeCsv.split('\r\n')[5]),
        group_total_physical_row: 9,
        group_total_raw_row_sha256: await sha256(nativeCsv.split('\r\n')[8]),
      });
      expect(ref.column_indices.transaction_id).toBeUndefined();
      expect(ref.mapping_version).toMatch(/^qbo-transaction-journal-v1:[0-9a-f]{64}$/);
      expect(ref.file_sha256).toBe(await sha256(nativeCsvBytes));
      expect(ref.raw_row_sha256).toBe(await sha256(nativeCsv.split('\r\n')[ref.physical_row - 1]));
      expect(row.accounting_batch_id).toBe(null);
      expect(row.linked_deposit_id).toBe(null);
    }
    expect(parsed.manifest?.coverage_confirmed).toBe(false);
    expect(parsed.manifest?.opening_debit_balance_cents).toBe(null);
    expect(parsed.manifest?.closing_debit_balance_cents).toBe(null);
    expect(parsed.controls.debitCents).toBe(90_000);
    expect(parsed.controls.creditCents).toBe(90_000);
  });

  it('rejects unrelated originalBytes instead of attributing parsed evidence to their hash', async () => {
    await assertRejected(nativeCsv, {
      originalBytes: new TextEncoder().encode('DIFFERENT SOURCE BYTES'),
    });
  });

  it('rejects stale decoded text paired with a changed source file', async () => {
    await assertRejected(nativeCsv, {
      originalBytes: new TextEncoder().encode(nativeCsv.replaceAll('RDCE641C900E', 'OTHER')),
    });
  });

  it('continues to reject native XLSX formulas instead of trusting cached subtotal values', async () => {
    expect(await sha256(nativeXlsxBytes)).toBe(
      'ac1b896b3377199496c67132968e8e61949f388eaa7a13c43ed52fcace95e033',
    );
    const parsed = await parseXlsx(nativeXlsxBytes, 'QBO', { ...options, sheetName: 'Sheet1' });
    expect(parsed.ok).toBe(false);
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'XLSX_FORMULA', severity: 'error' }),
      ]),
    );
  });
});

describe('synthetic controls, not additional real QBO observations', () => {
  it('parses a generated values-only workbook with equivalent amounts and group identity', async () => {
    const bytes = syntheticValuesOnlyXlsx();
    const parsed = await parseXlsx(bytes, 'QBO', {
      ...options,
      sheetName: 'Synthetic Values Only',
    });
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(
      parsed.rows.map((row) => [row.transaction_id, row.posting_date, row.signed_cents]),
    ).toEqual([
      ['145', '2026-09-30', 90_000],
      ['145', '2026-09-30', -90_000],
    ]);
    expect(parsed.manifest?.coverage_confirmed).toBe(false);
    expect(parsed.rows[0].source_refs[0].file_sha256).toBe(await sha256(bytes));
    expect(parsed.rows[0].source_refs[0].sheet).toBe('Synthetic Values Only');
  });

  it('preserves a second fully controlled group without borrowing its identity', async () => {
    const parsed = await parseSource(
      syntheticCsv((rows) => secondGroup(rows)),
      'QBO',
      options,
    );
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.rows.map((row) => row.transaction_id)).toEqual(['145', '145', '981', '981']);
    expect(parsed.controls.debitCents).toBe(180_000);
    expect(parsed.controls.creditCents).toBe(180_000);
    expect(parsed.manifest?.coverage_confirmed).toBe(false);
  });

  const mutations: Mutation[] = [
    [
      'missing group header',
      (r) => {
        r.splice(5, 1);
      },
    ],
    [
      'journal Num masquerading as group identity',
      (r) => {
        r[5][0] = 'RDCE641C900E';
        r[8][0] = 'Total for RDCE641C900E';
      },
    ],
    [
      'identity placed in Num column of group row',
      (r) => {
        r[5][0] = '';
        r[5][3] = '145';
      },
    ],
    [
      'group identity changed without matching closing identity',
      (r) => {
        r[5][0] = '146';
      },
    ],
    [
      'duplicate closed transaction ID',
      (r) => {
        secondGroup(r, '145');
      },
    ],
    [
      'interleaved group before current close',
      (r) => {
        r.splice(7, 0, ['981', '', '', '', '', '', '', '', '']);
      },
    ],
    [
      'missing group total',
      (r) => {
        r.splice(8, 1);
      },
    ],
    [
      'mismatched group closing identity',
      (r) => {
        r[8][0] = 'Total for 146';
      },
    ],
    [
      'group debit control mismatch',
      (r) => {
        r[8][7] = '$900.01';
      },
    ],
    [
      'group credit control mismatch',
      (r) => {
        r[8][8] = '$899.99';
      },
    ],
    [
      'grand debit control mismatch',
      (r) => {
        r[9][7] = '$900.01';
      },
    ],
    [
      'grand credit control mismatch',
      (r) => {
        r[9][8] = '$899.99';
      },
    ],
    [
      'missing grand total',
      (r) => {
        r.splice(9, 1);
      },
    ],
    [
      'duplicate grand total',
      (r) => {
        r.splice(10, 0, [...r[9]]);
      },
    ],
    [
      'missing export footer',
      (r) => {
        r.pop();
      },
    ],
    [
      'truncated immediately after posting legs',
      (r) => {
        r.splice(8);
      },
    ],
    [
      'truncated after grand total',
      (r) => {
        r.splice(10);
      },
    ],
    [
      'unrecognized footer',
      (r) => {
        r[13][0] = 'Exported by somebody';
      },
    ],
    [
      'malformed calendar in footer',
      (r) => {
        r[13][0] = ' Wednesday, February 30, 2026 11:52 AM GMTZ';
      },
    ],
    [
      'unknown row after footer',
      (r) => {
        r.push(['unrecognized', '', '', '', '', '', '', '', '']);
      },
    ],
    [
      'posting row after grand total',
      (r) => {
        r.splice(10, 0, [...r[6]]);
      },
    ],
    [
      'blank Num amount-bearing leg',
      (r) => {
        r[7][3] = '';
      },
    ],
    [
      'blank date amount-bearing leg',
      (r) => {
        r[7][1] = '';
      },
    ],
    [
      'mixed Num within group',
      (r) => {
        r[7][3] = 'DIFFERENT';
      },
    ],
    [
      'mixed date within group',
      (r) => {
        r[7][1] = '09/29/2026';
      },
    ],
    [
      'unbalanced posting group',
      (r) => {
        r[7][8] = '800.00';
        r[8][8] = '$800.00';
        r[9][8] = '$800.00';
      },
    ],
    [
      'unknown blank amounts',
      (r) => {
        r[6][7] = '';
      },
    ],
    [
      'zero amounts are not a posting leg',
      (r) => {
        r[6][7] = '0.00';
      },
    ],
    [
      'both positive debit and credit',
      (r) => {
        r[6][8] = '1.00';
      },
    ],
    [
      'non-USD currency symbol',
      (r) => {
        r[6][7] = '€900.00';
      },
    ],
    [
      'scientific notation amount',
      (r) => {
        r[6][7] = '9e2';
      },
    ],
    [
      'three decimal amount',
      (r) => {
        r[6][7] = '900.001';
      },
    ],
    [
      'ambiguous decimal grouping',
      (r) => {
        r[6][7] = '900,00';
      },
    ],
    [
      'negative debit',
      (r) => {
        r[6][7] = '-900.00';
      },
    ],
    [
      'formula-like debit',
      (r) => {
        r[6][7] = '=900';
      },
    ],
    [
      'invalid posting calendar date',
      (r) => {
        r[6][1] = '02/30/2026';
      },
    ],
    [
      'unsupported report title',
      (r) => {
        r[1][0] = 'General Ledger';
      },
    ],
    [
      'unsupported selected date scope',
      (r) => {
        r[2][0] = 'September 2026';
      },
    ],
    [
      'mismatched company label',
      (r) => {
        r[0][0] = 'Different Company';
      },
    ],
    [
      'extra mixed-company report preamble',
      (r) => {
        r.splice(9, 0, ['Other Company', '', '', '', '', '', '', '', '']);
      },
    ],
    [
      'unsupported extra currency column',
      (r) => {
        r.forEach((row) => {
          if (row.length === 9) row.push('');
        });
        r[4][9] = 'Currency';
        r[6][9] = 'EUR';
      },
    ],
    [
      'duplicate header inside group',
      (r) => {
        r.splice(7, 0, [...r[4]]);
      },
    ],
    [
      'control row hides an account',
      (r) => {
        r[8][6] = 'Hidden Account';
      },
    ],
    [
      'header account/description swap',
      (r) => {
        [r[4][5], r[4][6]] = [r[4][6], r[4][5]];
      },
    ],
    [
      'summary-looking posting cannot be skipped',
      (r) => {
        r[6][0] = 'TOTAL';
      },
    ],
  ];
  it.each(mutations)('atomically rejects %s', async (_, mutation) => {
    await assertRejected(syntheticCsv(mutation));
  });

  it.each([
    ['implicit profile', { profile: 'manual', headerRow: 5, bindings: { account_full_name: 6 } }],
    ['unsupported profile', { profile: 'qbo-transaction-journal-v999' }],
    ['missing company confirmation', { qboTransactionJournalCompanyName: undefined }],
    ['non-USD workspace', { currency: 'EUR' }],
    ['unconfirmed posted ledger', { postedLedgerConfirmed: false }],
    ['claim of full-period coverage', { coverageConfirmed: true }],
    ['contradictory account binding', { bindings: { account_full_name: 5 } }],
    [
      'invented account opening/closing controls',
      {
        accountBalances: [
          {
            account_id: null,
            account_full_name: 'Uncategorized Asset',
            opening_debit_balance_cents: 90_000,
            closing_debit_balance_cents: 0,
            coverage_confirmed: true,
          },
        ],
      },
    ],
  ])('refuses %s', async (_, invalid) => {
    await assertRejected(nativeCsv, invalid as Partial<ParseOptions>);
  });

  it('does not reuse this QBO report profile for QBD', async () => {
    const parsed = await parseSource(nativeCsv, 'QBD', options);
    expect(parsed.ok).toBe(false);
    expect(parsed.rows).toEqual([]);
  });

  it('keeps every synthetic generated variant separate from the original fixture bytes', () => {
    const original = matrix();
    const changed = matrix();
    secondGroup(changed);
    expect(original).toHaveLength(14);
    expect(changed).toHaveLength(18);
    expect(nativeCsv).toContain('145,,,,,,,,');
  });
});
