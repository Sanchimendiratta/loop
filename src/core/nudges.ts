/**
 * The nudge engine (§5.2).
 *
 * Under spec DL1 this carries more weight than the PRD gave it. D5's hard block
 * on new requests is gone, so nudging plus the tracker is now the *only*
 * mechanism keeping loops closed — §11's >70% closure rate is the number that
 * will tell us whether that was enough.
 *
 * The engine nudges exactly one person: whoever `stateOwner` says owes the next
 * update. Chasing both sides is how a referral network teaches people to ignore
 * its email.
 */
import { daysBetween } from './time.ts';
import { RESPONSE_WINDOW_DAYS, SUBMIT_WINDOW_DAYS, isTerminal } from './requests.ts';
import type { PostApplication, ReferralRequest, RequestState } from '../data/schema.ts';

export const SENT_NUDGE_DAYS = [3, 6] as const;
export const ACCEPTED_NUDGE_DAYS = [7] as const;
export const SUBMITTED_NUDGE_DAYS = [14, 30, 45] as const;
export const MAX_NUDGES = 3;
export const APPLICATION_PROMPT_DAY = 14;

function scheduleFor(state: RequestState): readonly number[] {
  if (state === 'sent') return SENT_NUDGE_DAYS;
  if (state === 'accepted') return ACCEPTED_NUDGE_DAYS;
  if (state === 'submitted' || state === 'recruiter_contact' || state === 'interviewing') return SUBMITTED_NUDGE_DAYS;
  return [];
}

/**
 * Days are measured from when the current state began, not from the last
 * nudge: the schedule is absolute, so a missed send does not push the whole
 * sequence back.
 */
export function nudgeDueFor(
  r: ReferralRequest,
  now: number,
): { due: boolean; target: 'seeker' | 'referrer' | null; nudgeNumber: number } {
  if (isTerminal(r.state) || r.stateOwner === null) return { due: false, target: null, nudgeNumber: 0 };

  const schedule = scheduleFor(r.state);
  if (r.nudgeCount >= Math.min(MAX_NUDGES, schedule.length)) {
    return { due: false, target: r.stateOwner, nudgeNumber: r.nudgeCount };
  }

  const elapsed = daysBetween(r.updatedAt, now);
  const nextThreshold = schedule[r.nudgeCount];
  if (nextThreshold === undefined) return { due: false, target: r.stateOwner, nudgeNumber: r.nudgeCount };

  return { due: elapsed >= nextThreshold, target: r.stateOwner, nudgeNumber: r.nudgeCount + 1 };
}

/** What the system should do on its own, if anything. */
export function autoAdvanceFor(r: ReferralRequest, now: number): RequestState | null {
  if (isTerminal(r.state)) return null;
  const elapsed = daysBetween(r.updatedAt, now);

  if (r.state === 'sent' && elapsed >= RESPONSE_WINDOW_DAYS) return 'expired';
  if (r.state === 'accepted' && elapsed >= SUBMIT_WINDOW_DAYS) return 'expired_unsubmitted';

  const outcomeStates: RequestState[] = ['submitted', 'recruiter_contact', 'interviewing'];
  if (outcomeStates.includes(r.state) && r.nudgeCount >= MAX_NUDGES) {
    const lastNudge = r.lastNudgedAt ?? r.updatedAt;
    if (daysBetween(lastNudge, now) >= 1) return 'no_response';
  }
  return null;
}

/** §5.1: one prompt, never blocking. A job board cannot fairly be gated. */
export function applicationPromptDue(a: PostApplication, now: number): boolean {
  if (a.outcome !== 'unknown') return false;
  if (a.promptedAt !== null) return false;
  return daysBetween(a.appliedAt, now) >= APPLICATION_PROMPT_DAY;
}
