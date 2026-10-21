import type { CalendarConfig } from '../contracts/engine';
export function validISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function nth(y: number, m: number, weekday: number, n: number): string {
  const d = new Date(Date.UTC(y, m, 1));
  d.setUTCDate(1 + ((weekday - d.getUTCDay() + 7) % 7) + (n - 1) * 7);
  return iso(d);
}
function last(y: number, m: number, weekday: number): string {
  const d = new Date(Date.UTC(y, m + 1, 0));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - weekday + 7) % 7));
  return iso(d);
}
/** Federal Reserve settlement convention: Sunday fixed holidays observed Monday;
 * Saturday holidays are not moved to Friday. Explicit provider overrides replace defaults. */
export function settlementHolidays(year: number): string[] {
  const fixed = [
    [0, 1],
    [5, 19],
    [6, 4],
    [10, 11],
    [11, 25],
  ].map(([m, day]) => {
    const d = new Date(Date.UTC(year, m!, day!));
    if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
    return iso(d);
  });
  return [
    ...fixed,
    nth(year, 0, 1, 3),
    nth(year, 1, 1, 3),
    last(year, 4, 1),
    nth(year, 8, 1, 1),
    nth(year, 9, 1, 2),
    nth(year, 10, 4, 4),
  ].sort();
}
export function businessAdd(date: string, days: number, calendar: CalendarConfig = {}): string {
  if (!validISODate(date) || !Number.isInteger(days) || Math.abs(days) > 3660)
    throw new Error('Invalid business date/offset');
  const d = new Date(`${date}T00:00:00Z`);
  const step = days < 0 ? -1 : 1;
  let remaining = Math.abs(days);
  const holidays = new Set(
    calendar.holidays ?? [
      ...settlementHolidays(d.getUTCFullYear() - 1),
      ...settlementHolidays(d.getUTCFullYear()),
      ...settlementHolidays(d.getUTCFullYear() + 1),
    ],
  );
  while (remaining) {
    d.setUTCDate(d.getUTCDate() + step);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !holidays.has(iso(d))) remaining--;
  }
  return iso(d);
}
export function inWindow(anchor: string, observed: string, calendar: CalendarConfig = {}): boolean {
  return (
    observed >= businessAdd(anchor, -1, calendar) && observed <= businessAdd(anchor, 5, calendar)
  );
}
