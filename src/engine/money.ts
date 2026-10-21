export const MAX_ROW_CENTS = 100_000_000_000;
export function assertCents(value: unknown, label = 'amount', row = true): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    (row && Math.abs(value) > MAX_ROW_CENTS)
  )
    throw new Error(`${label}: expected safe integer cents${row ? ' within row limit' : ''}`);
}
export function sumCents(values: Iterable<number>): number {
  let sum = 0;
  for (const n of values) {
    assertCents(n, 'summand', false);
    sum += n;
    assertCents(sum, 'aggregate', false);
  }
  return sum;
}
export function feeInBand(gross: number, difference: number, method: string): boolean {
  assertCents(gross, 'gross', false);
  assertCents(difference, 'fee candidate', false);
  if (gross <= 0 || difference <= 0) return false;
  const bands = method === 'CARD' ? [150, 380] : method === 'FINANCING' ? [500, 1500] : null;
  return (
    !!bands &&
    BigInt(bands[0]!) * BigInt(gross) <= 10000n * BigInt(difference) &&
    10000n * BigInt(difference) <= BigInt(bands[1]!) * BigInt(gross)
  );
}
