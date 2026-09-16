/**
 * Day arithmetic.
 *
 * Every window in this product is measured in calendar days, not business
 * hours: a referral sits with a referrer over a weekend just as it does midweek,
 * and a post ages the same way. That is the opposite of Pipelined's SLA clock,
 * and deliberately so — this side of the market is unpaid volunteers, not staff
 * on a working week.
 */
export const DAY_MS = 86_400_000;

/** Whole days elapsed, floored, never negative. */
export function daysBetween(from: number, to: number): number {
  if (to <= from) return 0;
  return Math.floor((to - from) / DAY_MS);
}

export function addDays(at: number, days: number): number {
  return at + days * DAY_MS;
}

/** Local midnight for the day containing `at`. */
export function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
