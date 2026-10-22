import { describe, expect, it } from 'vitest';
import { buildSyntheticDemo } from '../../scripts/synthetic-demo';

describe('synthetic demonstration catalog', () => {
  it('derives five truthful scenarios from the real parser and engine without approving export', async () => {
    const demo = await buildSyntheticDemo();
    expect(demo.classification).toBe('SYNTHETIC / DO NOT IMPORT');
    expect(demo.externalCalls).toBe(0);
    expect(demo.accountingWrites).toBe(0);
    expect(demo.scenarios.map((s) => s.id)).toEqual([
      'clean-arithmetic',
      'documented-fee',
      'undeposited-funds',
      'ambiguous',
      'invalid-input-blocked',
    ]);
    const fee = demo.scenarios.find((s) => s.id === 'documented-fee')!;
    expect(fee).toMatchObject({
      grossCents: 1000000,
      bankCents: 910000,
      feeCents: 90000,
      feeDraftEligible: false,
    });
    expect(demo.scenarios.find((s) => s.id === 'invalid-input-blocked')).toMatchObject({
      importAllowed: false,
    });
  });
});
