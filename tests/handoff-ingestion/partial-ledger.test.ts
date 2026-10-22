import { describe, it, expect } from 'vitest';
import { parseSource } from '../../src/ingestion/csv';
import type { ParseOptions } from '../../src/ingestion/types';
const options: ParseOptions = {
  companyId: 'CO',
  bankAccountId: 'BANK',
  currency: 'USD',
  companyTimezone: 'Etc/UTC',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  asOfDate: '2026-09-30',
  dateFormat: 'ISO',
  postedLedgerConfirmed: true,
  allowPartialTransactions: true,
  ledgerReportScope: 'COMPLETE_JOURNAL',
};
const header = 'Transaction ID,Line ID,Date,Transaction Type,Account,Debit,Credit';
const good = [
  'GOOD,L1,2026-09-01,Journal Entry,Clearing,100,',
  'GOOD,L2,2026-09-01,Journal Entry,AR,,100',
];
function csv(rows: string[]) {
  return [header, ...rows].join('\n');
}
describe('explicit partial ledger semantics', () => {
  it('isolates all known legs when one malformed amount exists, without summary misclassification', async () => {
    const result = await parseSource(
      csv([
        ...good,
        'BAD,L3,2026-09-02,Journal Entry,Clearing,100,',
        'BAD,L4,2026-09-02,Journal Entry,AR,,broken',
      ]),
      'QBO',
      options,
    );
    expect(result.status, JSON.stringify(result.issues)).toBe('PARTIAL');
    expect(result.rows.map((r) => r.transaction_id)).toEqual(['GOOD', 'GOOD']);
    expect(result.controls.quarantinedGroups?.[0].physicalRows).toEqual([4, 5]);
    expect(result.controls.excludedRows).toHaveLength(0);
    expect(result.manifest?.coverage_confirmed).toBe(false);
  });
  it('isolates a complete-journal group with a missing leg', async () => {
    const result = await parseSource(
      csv([...good, 'BAD,L3,2026-09-02,Journal Entry,Clearing,100,']),
      'QBO',
      options,
    );
    expect(result.status).toBe('PARTIAL');
    expect(result.rows).toHaveLength(2);
  });
  it('accepts one-sided account activity without claiming complete journal proof', async () => {
    const result = await parseSource(
      csv(['ONE,L1,2026-09-01,Journal Entry,Clearing,100,']),
      'QBO',
      { ...options, ledgerReportScope: 'ACCOUNT_ACTIVITY' },
    );
    expect(result.status, JSON.stringify(result.issues)).toBe('READY');
    expect(result.rows).toHaveLength(1);
    expect(result.manifest?.qbo_transaction_journal).toBeUndefined();
  });
  it('blocks unknown invalid transaction identity rather than risking an orphan leg', async () => {
    const result = await parseSource(
      csv([...good, ',L3,2026-09-02,Journal Entry,Clearing,broken,']),
      'QBO',
      options,
    );
    expect(result.status).toBe('BLOCKED');
    expect(result.rows).toHaveLength(0);
  });
  it('remains atomic unless partial recovery was explicitly enabled', async () => {
    const result = await parseSource(
      csv([...good, 'BAD,L3,2026-09-02,Journal Entry,Clearing,broken,']),
      'QBO',
      { ...options, allowPartialTransactions: false },
    );
    expect(result.status).toBe('BLOCKED');
    expect(result.rows).toHaveLength(0);
  });
});
