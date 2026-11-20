import { DAY, toMs } from '@x10/shared/lib';

/**
 * Add calendar months in UTC. The day of month is clamped to the target month's length,
 * so 31 Jan + 1 month is 28/29 Feb (not 3 Mar).
 */
export function addMonths(iso: string | Date, months: number): string {
  const d = new Date(toMs(iso));
  const day = d.getUTCDate();
  const target = new Date(d.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

/**
 * Days from now until `iso` by elapsed time, rounded up: something due in 9.9 days is "10 days" away.
 * Negative when past ("expired 5 days ago" is -5). Use millisecond comparisons, not this, to decide "past".
 */
export function daysUntil(iso: string, now: Date): number {
  const d = Math.ceil((toMs(iso) - now.getTime()) / DAY);
  return d === 0 ? 0 : d;
}
