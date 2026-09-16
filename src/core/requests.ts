/**
 * The referral request state machine (§5.2).
 *
 * `stateOwner` is written on every transition rather than derived on read. The
 * tracker and the nudge engine both ask whose turn it is, and if they ever
 * computed it independently they could disagree — which would show up as the
 * product nagging the wrong person, the single fastest way to lose a referrer.
 *
 * Transitions are refused rather than corrected. A request that reaches an
 * impossible state is a bug worth surfacing, not one worth papering over.
 */
import { addDays } from './time.ts';
import { TERMINAL_REQUEST_STATES } from '../data/schema.ts';
import type { DeclineReason, ReferralRequest, RequestState } from '../data/schema.ts';

export class RuleViolation extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'RuleViolation';
    this.code = code;
  }
}

export const RESPONSE_WINDOW_DAYS = 7;
export const SUBMIT_WINDOW_DAYS = 14;
export const OUTCOME_WINDOW_DAYS = 14;

export const OWNER_BY_STATE: Record<RequestState, 'seeker' | 'referrer' | null> = {
  sent: 'referrer',
  accepted: 'referrer',
  submitted: 'seeker',
  recruiter_contact: 'seeker',
  interviewing: 'seeker',
  declined: null,
  offer: null,
  rejected: null,
  no_response: null,
  expired: null,
  expired_unsubmitted: null,
  role_closed: null,
};

export const TRANSITIONS: Record<RequestState, RequestState[]> = {
  sent: ['accepted', 'declined', 'expired'],
  accepted: ['submitted', 'role_closed', 'expired_unsubmitted'],
  submitted: ['recruiter_contact', 'interviewing', 'offer', 'rejected', 'no_response'],
  recruiter_contact: ['interviewing', 'offer', 'rejected', 'no_response'],
  interviewing: ['offer', 'rejected', 'no_response'],
  declined: [],
  offer: [],
  rejected: [],
  no_response: [],
  expired: [],
  expired_unsubmitted: [],
  role_closed: [],
};

const REFERRER_ONLY: RequestState[] = ['accepted', 'declined', 'submitted', 'role_closed'];
const SEEKER_ONLY: RequestState[] = ['interviewing', 'offer', 'rejected'];
const EITHER: RequestState[] = ['recruiter_contact'];
const SYSTEM_ONLY: RequestState[] = ['expired', 'expired_unsubmitted', 'no_response'];

export function isTerminal(s: RequestState): boolean {
  return TERMINAL_REQUEST_STATES.includes(s);
}

export function canTransition(from: RequestState, to: RequestState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function actorMayTransition(role: 'seeker' | 'referrer' | 'system', to: RequestState): boolean {
  if (role === 'system') return SYSTEM_ONLY.includes(to);
  if (EITHER.includes(to)) return true;
  if (role === 'referrer') return REFERRER_ONLY.includes(to);
  return SEEKER_ONLY.includes(to);
}

/** Days the new owner gets before the first nudge lands. */
function windowFor(to: RequestState): number | null {
  if (to === 'accepted') return SUBMIT_WINDOW_DAYS;
  if (to === 'submitted' || to === 'recruiter_contact' || to === 'interviewing') return OUTCOME_WINDOW_DAYS;
  return null;
}

export function applyTransition(
  r: ReferralRequest,
  to: RequestState,
  role: 'seeker' | 'referrer' | 'system',
  at: number,
  opts: { declineReason?: DeclineReason } = {},
): ReferralRequest {
  if (!canTransition(r.state, to)) {
    throw new RuleViolation(`A request cannot go from ${r.state} to ${to}.`, 'illegal_transition');
  }
  if (!actorMayTransition(role, to)) {
    throw new RuleViolation(`A ${role} cannot move a request to ${to}.`, 'wrong_actor');
  }
  if (to === 'declined' && !opts.declineReason) {
    throw new RuleViolation('Give a reason so the seeker knows where they stand.', 'missing_decline_reason');
  }

  const owner = OWNER_BY_STATE[to];
  const window = windowFor(to);

  return {
    ...r,
    state: to,
    stateOwner: owner,
    declineReason: to === 'declined' ? (opts.declineReason ?? null) : r.declineReason,
    nextUpdateDue: window === null ? null : addDays(at, window),
    // A new owner starts with a clean slate; nudges chase the current turn.
    nudgeCount: 0,
    lastNudgedAt: null,
    updatedAt: at,
  };
}
