export const MAX_CENTS = 100_000_000_000;
export function parseMoney(value: string, nullable = false): number | null {
  let s = value.trim();
  if (!s) {
    if (nullable) return null;
    throw new Error('Missing amount is unknown, not zero.');
  }
  if (/^[=+@]/.test(s) || /[\x00-\x1f\x7f]/.test(s))
    throw new Error('Unsafe or unsupported amount.');
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    if (negative) throw new Error('Conflicting amount signs.');
    negative = true;
    s = s.slice(1);
  }
  if (s.startsWith('$')) s = s.slice(1);
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))
    throw new Error(
      'Amount must use unambiguous US decimal format with at most two decimal places.',
    );
  const [whole, fraction = ''] = s.replaceAll(',', '').split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(MAX_CENTS)) throw new Error('Amount exceeds the per-row safety limit.');
  return Number(cents) * (negative ? -1 : 1);
}
export function parseDate(
  value: string,
  format: 'MDY' | 'ISO' = 'MDY',
  nullable = false,
): string | null {
  const s = value.trim();
  if (!s && nullable) return null;
  const m = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    : format === 'MDY'
      ? s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
      : null;
  if (!m)
    throw new Error('Date must be a real ISO date or explicitly selected US MM/DD/YYYY date.');
  const iso = m[1].length === 4 ? s : `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.valueOf()) || d.toISOString().slice(0, 10) !== iso)
    throw new Error('Invalid calendar date.');
  return iso;
}
export function timestamp(value: string, nullable = false): string | null {
  if (!value.trim() && nullable) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error('Timestamp requires an explicit timezone.');
  parseDate(value.slice(0, 10), 'ISO');
  return value;
}
export const upper = (s: string) => s.trim().toUpperCase().replace(/[ -]+/g, '_');
export function bool(value: string): boolean | null {
  const s = upper(value);
  if (['TRUE', 'YES', '1'].includes(s)) return true;
  if (['FALSE', 'NO', '0'].includes(s)) return false;
  if (!s || s === 'UNKNOWN') return null;
  throw new Error('Unrecognized boolean; explicit Yes/No required.');
}
export function checkedSum(values: number[]): number {
  let sum = 0;
  for (const n of values) {
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger((sum += n)))
      throw new Error('Unsafe cumulative cents.');
  }
  return sum;
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    if (s === undefined) throw new Error('Undefined canonical payload.');
    return s;
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}
export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Cents must be a safe integer.');
  const magnitude = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`;
}
