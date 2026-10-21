import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSource, parseMoney, parseDate, decodeCsv } from '../../src/ingestion';
import type { ParseOptions } from '../../src/ingestion';
const options: ParseOptions = {
  companyId: 'TEST',
  bankAccountId: 'BANK',
  companyTimezone: 'America/New_York',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  asOfDate: '2026-09-30',
  currency: 'USD',
  profile: 'synthetic-v1',
};
const csv = (name: string) =>
  readFileSync(new URL(`../../samples/${name}`, import.meta.url), 'utf8');
describe('local boundary parser', () => {
  it('reads supplied core files without relying on answer keys', async () => {
    const st = await parseSource(csv('st_export.csv'), 'ST', options),
      qb = await parseSource(csv('qbo_clearing_gl.csv'), 'QBO', options),
      bank = await parseSource(csv('chase_bank.csv'), 'BANK', options);
    expect(st.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(qb.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(bank.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(st.rows).toHaveLength(359);
    expect(qb.rows).toHaveLength(338);
    expect(bank.rows).toHaveLength(140);
    expect(st.rows[0].reported_fee_cents).toBeNull();
    expect(st.manifest?.opening_debit_balance_cents).toBeNull();
    expect(st.manifest?.coverage_confirmed).toBe(false);
  });
  it('reads enhanced evidence but does not manufacture ledger coverage', async () => {
    for (const [name, kind] of [
      ['processor_settlements.csv', 'PROCESSOR'],
      ['external_receipts.csv', 'RECEIPT'],
      ['deposit_components.csv', 'COMPONENT'],
      ['st_audit_events.csv', 'AUDIT'],
    ] as const) {
      const result = await parseSource(csv(name), kind, options);
      expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.manifest?.coverage_confirmed).toBe(false);
    }
  });
  it('parses cents without floating dollars, rejecting ambiguity', () => {
    expect(parseMoney('($1,234.56)')).toBe(-123456);
    expect(parseMoney('0.01')).toBe(1);
    expect(parseMoney('', true)).toBeNull();
    for (const bad of ['', '1e3', '1.001', '1,23', '1.234,56', '=1+1', 'NaN', '1000000000.01'])
      expect(() => parseMoney(bad)).toThrow();
  });
  it('rejects invalid dates, never timezone-shifts', () => {
    expect(parseDate('09/30/2026')).toBe('2026-09-30');
    for (const bad of ['02/29/2026', '2026-13-01', '01/01/26'])
      expect(() => parseDate(bad)).toThrow();
  });
  it('preserves original multiline physical rows and SHA provenance', async () => {
    const r = await parseSource(
      'Posting Date,Amount,Description\r\n09/01/2026,1.00,"two\nlines"\r\n09/02/2026,-2.00,refund\r\n',
      'BANK',
      options,
    );
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => x.source_refs[0].physical_row)).toEqual([2, 4]);
    expect(r.rows[0].source_refs[0].raw_row_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.rows[1].signed_cents).toBe(-200);
  });
  it('same file is idempotent but identical anonymous bank rows are preserved', async () => {
    const text = 'Posting Date,Amount,Description\n09/01/2026,1.00,same\n09/01/2026,1.00,same\n';
    const one = await parseSource(text, 'BANK', options);
    expect(one.rows).toHaveLength(2);
    expect(one.rows[0].id).not.toBe(one.rows[1].id);
    const again = await parseSource(text, 'BANK', {
      ...options,
      seenFileHashes: [one.manifest!.source_file_sha256],
    });
    expect(again.duplicate).toBe(true);
    expect(again.rows).toHaveLength(0);
  });
  it('deduplicates payment application gross and preserves all row references', async () => {
    const r = await parseSource(
      'Payment ID,Payment Date,Payment Amount,Invoice ID,Amount Allocated\nP1,09/01/2026,100.00,I1,30.00\nP1,09/01/2026,100.00,I2,30.00\nP1,09/01/2026,100.00,I3,40.00',
      'ST',
      options,
    );
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].gross_cents).toBe(10000);
    expect(r.rows[0].source_refs).toHaveLength(3);
    expect(r.rows[0].invoice_allocations).toHaveLength(3);
  });
  it('rejects overallocated payment application', async () => {
    const r = await parseSource(
      'Payment ID,Payment Date,Payment Amount,Invoice ID,Amount Allocated\nP1,09/01/2026,100.00,I1,60.00\nP1,09/01/2026,100.00,I2,60.00',
      'ST',
      options,
    );
    expect(r.ok).toBe(false);
    expect(r.rows).toEqual([]);
  });
  it('does not substitute invoice totals or balance for receipts', async () => {
    for (const field of ['Invoice Total', 'Balance']) {
      const r = await parseSource(
        `Payment ID,Payment Date,${field}\nP1,09/01/2026,100`,
        'ST',
        options,
      );
      expect(r.ok).toBe(false);
    }
  });
  it('rejects ambiguous amount columns until a manual index is selected', async () => {
    const text = 'Posting Date,Amount,Amount\n09/01/2026,1.00,2.00';
    expect((await parseSource(text, 'BANK', options)).ok).toBe(false);
    const r = await parseSource(text, 'BANK', { ...options, bindings: { signed_cents: 2 } });
    expect(r.rows[0].signed_cents).toBe(200);
  });
  it('excludes repeated headers and total rows while blocking malformed data', async () => {
    const r = await parseSource(
      'Posting Date,Amount\n09/01/2026,1.00\nPosting Date,Amount\nTOTAL,1.00',
      'BANK',
      options,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.manifest?.excluded_summary_rows).toEqual([3, 4]);
    expect(
      (await parseSource('Posting Date,Amount\n09/01/2026,1.00,EXTRA', 'BANK', options)).ok,
    ).toBe(false);
  });
  it('rejects unsupported currencies, companies, formulas and missing money', async () => {
    for (const text of [
      'Posting Date,Amount,Currency\n09/01/2026,1.00,EUR',
      'Posting Date,Amount,Company ID\n09/01/2026,1.00,OTHER',
      'Posting Date,Amount\n09/01/2026,=1+1',
      'Posting Date,Amount\n09/01/2026,',
    ])
      expect((await parseSource(text, 'BANK', options)).ok).toBe(false);
  });
  it('requires explicit posted-ledger semantics; neither blank debit nor credit invents zero', async () => {
    const text = 'Date,Account,Debit,Credit\n09/01/2026,Clearing,,';
    expect((await parseSource(text, 'QBO', options)).ok).toBe(false);
    expect(
      (
        await parseSource(text.replace(',,', ',1,'), 'QBO', {
          ...options,
          profile: 'manual',
          dateFormat: 'MDY',
        })
      ).ok,
    ).toBe(false);
  });
  it('requires explicit UTF16 decode and caps columns and cells', async () => {
    expect(() => decodeCsv(new Uint8Array([255, 254, 65, 0]))).toThrow();
    const long = await parseSource(
      `Posting Date,Amount,Description\n09/01/2026,1.00,${'x'.repeat(4097)}`,
      'BANK',
      options,
    );
    expect(long.ok).toBe(false);
    expect((await parseSource('x'.repeat(10 * 1024 * 1024 + 1), 'BANK', options)).ok).toBe(false);
  });
});

describe('additional source identity and privacy boundaries', () => {
  it('anonymous identical QB posting lines remain separate source atoms', async () => {
    const r = await parseSource(
      'Date,Account,Debit,Credit\n09/01/2026,Clearing,1.00,\n09/01/2026,Clearing,1.00,',
      'QBO',
      options,
    );
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].id).not.toBe(r.rows[1].id);
  });
  it('manual mapping cannot relabel a known invoice total as cash', async () => {
    const r = await parseSource(
      'Payment ID,Payment Date,Invoice Total\nP1,09/01/2026,100.00',
      'ST',
      { ...options, bindings: { gross_cents: 2 } },
    );
    expect(r.ok).toBe(false);
  });
  it('generic bank data requires confirmed sign semantics and rejects conflicting details', async () => {
    const text = 'Posting Date,Amount\n09/01/2026,1.00';
    const opts = {
      ...options,
      profile: 'manual' as const,
      dateFormat: 'MDY' as const,
      bankPostedConfirmed: true,
    };
    expect((await parseSource(text, 'BANK', opts)).ok).toBe(false);
    expect(
      (await parseSource(text, 'BANK', { ...opts, bankSignConvention: 'INFLOW_POSITIVE' })).ok,
    ).toBe(true);
    expect(
      (await parseSource('Posting Date,Amount,Details\n09/01/2026,-1.00,CREDIT', 'BANK', options))
        .ok,
    ).toBe(false);
  });
  it('keeps missing held fee, net and payout reference unknown rather than zero', async () => {
    const r = await parseSource(csv('processor_settlements.csv'), 'PROCESSOR', options);
    const held = r.rows.find((x) => x.status === 'HELD')!;
    expect(held.fee_cents).toBeNull();
    expect(held.net_cents).toBeNull();
    expect(held.settlement_reference).toBeNull();
    expect(held.release_coverage_confirmed).toBe(false);
  });
});

describe('manual mapping omissions', () => {
  it('explicitly omitted fields are not silently restored by aliases', async () => {
    const text = 'Posting Date,Amount,Description\n09/01/2026,1.00,private memo';
    const r = await parseSource(text, 'BANK', {
      ...options,
      excludedTargets: ['description_local'],
    });
    expect(r.ok).toBe(true);
    expect(r.mapping!.bindings.description_local).toBeUndefined();
    expect(r.rows[0].description_local).toBe('');
  });
  it('required omissions block import and contradictory mapping requests fail closed', async () => {
    const text = 'Posting Date,Amount\n09/01/2026,1.00';
    const omitted = await parseSource(text, 'BANK', {
      ...options,
      excludedTargets: ['signed_cents'],
    });
    expect(omitted.ok).toBe(false);
    expect(omitted.rows).toEqual([]);
    const conflict = await parseSource(text, 'BANK', {
      ...options,
      excludedTargets: ['signed_cents'],
      bindings: { signed_cents: 1 },
    });
    expect(conflict.ok).toBe(false);
  });
});
