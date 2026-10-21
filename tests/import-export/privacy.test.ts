import { describe, expect, it } from 'vitest';
import { syntheticMappingPreview } from '../../src/mapping/redact';
import { mappingCacheKey } from '../../src/mapping/cache';
describe('local mapping privacy', () => {
  it('uses only known safe headers and synthetic values, never original personal data', () => {
    const p = syntheticMappingPreview(
      ['Payment ID', 'Customer Name', 'Memo', 'Jane Doe private column', 'john@example.com'],
      [['PMTSECRET9981', 'Alice Sensitive', 'Call me at 555-123-4567', 'real data', 'private']],
      'ST',
    );
    const serialized = JSON.stringify(p);
    for (const secret of ['SECRET', 'Alice', 'Sensitive', '555', 'Jane', 'john@', 'private'])
      expect(serialized).not.toContain(secret);
    expect(p.sample_rows[0]).toEqual(['TEXT', 'TEXT', 'TEXT', 'TEXT', 'TEXT']);
  });
  it('mapping keys remain company-scoped and invalidate on schema/sign changes', async () => {
    const m = {
      companyId: 'A',
      sourceKind: 'BANK' as const,
      headers: ['Amount'],
      columnTypeSignature: ['MONEY'],
      dateConvention: 'MDY' as const,
      signConvention: 'INFLOW_POSITIVE',
      rowGrain: 'TRANSACTION',
      schemaVersion: '1.0' as const,
      bindings: { signed_cents: 0 },
      reviewed: true as const,
    };
    expect(await mappingCacheKey(m)).not.toBe(await mappingCacheKey({ ...m, companyId: 'B' }));
    expect(await mappingCacheKey(m)).not.toBe(
      await mappingCacheKey({ ...m, signConvention: 'OUTFLOW_POSITIVE' }),
    );
  });
});
