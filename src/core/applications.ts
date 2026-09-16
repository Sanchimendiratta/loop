/**
 * The application status ladder, and Lite's only nudge (§6 sheet 2).
 *
 * v1.3 had a nudge engine that chased whoever owed an update by email. Lite has
 * no email and no engine: a row untouched for 14 days shows a soft amber dot
 * and the sheet header says how many. "The sheet nags gently by looking
 * incomplete." Nothing blocks, nothing penalises.
 *
 * A terminal status is never stale — the ladder has ended, so there is nothing
 * left for the member to tell us, and dotting it would be nagging about
 * something already finished.
 */
import { daysBetween } from './time.ts';
import { TERMINAL_APPLICATION_STATUSES } from '../data/schema.ts';
import type { Application, ApplicationStatus } from '../data/schema.ts';

export const STALE_APPLICATION_DAYS = 14;

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  yet_to_respond: 'Yet to respond',
  in_review: 'In review',
  interview_scheduled: 'Interview scheduled',
  awaiting_next_round: 'Awaiting next round',
  offer: 'Offer',
  rejected: 'Rejected',
  no_response: 'No response',
};

export function isStale(a: Application, now: number): boolean {
  if (TERMINAL_APPLICATION_STATUSES.includes(a.status)) return false;
  return daysBetween(a.statusUpdatedAt, now) >= STALE_APPLICATION_DAYS;
}

export function staleCount(apps: Application[], now: number): number {
  return apps.filter((a) => isStale(a, now)).length;
}

export function staleNotice(n: number): string | null {
  if (n <= 0) return null;
  return n === 1
    ? "1 application hasn't been updated in a while."
    : `${n} applications haven't been updated in a while.`;
}
