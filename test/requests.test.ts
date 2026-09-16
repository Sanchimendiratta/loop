import { describe, expect, test } from 'vitest';
import {
  OWNER_BY_STATE, RuleViolation, actorMayTransition, applyTransition, canTransition, isTerminal,
} from '../src/core/requests.ts';
import { DAY_MS } from '../src/core/time.ts';
import { REQUEST_STATES, TERMINAL_REQUEST_STATES } from '../src/data/schema.ts';
import type { ReferralRequest } from '../src/data/schema.ts';

const NOW = Date.UTC(2026, 8, 16);
const req = (over: Partial<ReferralRequest> = {}): ReferralRequest => ({
  id: 'r1', seekerId: 'm1', referrerId: 'm2', companyId: 'c1', jobPostId: null,
  roleUrl: null, roleTitle: 'PM', resumeVersionId: 'rv1', pitch: 'hi',
  state: 'sent', stateOwner: 'referrer', declineReason: null,
  nextUpdateDue: NOW + 7 * DAY_MS, nudgeCount: 0, lastNudgedAt: null,
  createdAt: NOW, updatedAt: NOW, ...over,
});

describe('who owes the next update', () => {
  test('a sent request is owed by the referrer', () => {
    expect(OWNER_BY_STATE.sent).toBe('referrer');
  });

  test('an accepted request is still owed by the referrer — accepting is not doing', () => {
    expect(OWNER_BY_STATE.accepted).toBe('referrer');
  });

  test('once submitted the seeker owes the outcome', () => {
    expect(OWNER_BY_STATE.submitted).toBe('seeker');
    expect(OWNER_BY_STATE.recruiter_contact).toBe('seeker');
    expect(OWNER_BY_STATE.interviewing).toBe('seeker');
  });

  test('every terminal state is owed by nobody', () => {
    for (const s of TERMINAL_REQUEST_STATES) expect(OWNER_BY_STATE[s]).toBeNull();
  });
});

describe('legal transitions', () => {
  test('sent may be accepted, declined or expire', () => {
    expect(canTransition('sent', 'accepted')).toBe(true);
    expect(canTransition('sent', 'declined')).toBe(true);
    expect(canTransition('sent', 'expired')).toBe(true);
  });

  test('a request cannot skip acceptance and be submitted', () => {
    expect(canTransition('sent', 'submitted')).toBe(false);
  });

  test('a terminal state goes nowhere', () => {
    // Every terminal state against every state, not one sampled target.
    for (const s of TERMINAL_REQUEST_STATES) {
      expect(isTerminal(s)).toBe(true);
      for (const to of REQUEST_STATES) {
        expect(canTransition(s, to), `${s} -> ${to} must be refused`).toBe(false);
      }
    }
  });

  test('an accepted request may be submitted, closed or lapse', () => {
    expect(canTransition('accepted', 'submitted')).toBe(true);
    expect(canTransition('accepted', 'role_closed')).toBe(true);
    expect(canTransition('accepted', 'expired_unsubmitted')).toBe(true);
  });
});

describe('who may make a transition', () => {
  test('only the referrer accepts, declines or submits', () => {
    expect(actorMayTransition('referrer', 'accepted')).toBe(true);
    expect(actorMayTransition('seeker', 'accepted')).toBe(false);
    expect(actorMayTransition('seeker', 'submitted')).toBe(false);
  });

  test('only the seeker reports the outcome', () => {
    expect(actorMayTransition('seeker', 'offer')).toBe(true);
    expect(actorMayTransition('referrer', 'offer')).toBe(false);
  });

  test('either side may log first recruiter contact', () => {
    expect(actorMayTransition('seeker', 'recruiter_contact')).toBe(true);
    expect(actorMayTransition('referrer', 'recruiter_contact')).toBe(true);
  });

  test('only the system expires a request', () => {
    expect(actorMayTransition('system', 'expired')).toBe(true);
    expect(actorMayTransition('referrer', 'expired')).toBe(false);
  });

  test('every system-only state is closed to both humans', () => {
    // Enumerated rather than sampled: a refactor of SYSTEM_ONLY that dropped one
    // of these would otherwise leave the suite green.
    for (const s of ['expired', 'expired_unsubmitted', 'no_response'] as const) {
      expect(actorMayTransition('system', s), `system should set ${s}`).toBe(true);
      expect(actorMayTransition('seeker', s), `seeker must not set ${s}`).toBe(false);
      expect(actorMayTransition('referrer', s), `referrer must not set ${s}`).toBe(false);
    }
  });

  test('every seeker-only outcome is closed to the referrer', () => {
    for (const s of ['interviewing', 'offer', 'rejected'] as const) {
      expect(actorMayTransition('seeker', s), `seeker should set ${s}`).toBe(true);
      expect(actorMayTransition('referrer', s), `referrer must not set ${s}`).toBe(false);
    }
  });

  test('every referrer-only action is closed to the seeker', () => {
    for (const s of ['accepted', 'declined', 'submitted', 'role_closed'] as const) {
      expect(actorMayTransition('referrer', s), `referrer should set ${s}`).toBe(true);
      expect(actorMayTransition('seeker', s), `seeker must not set ${s}`).toBe(false);
    }
  });
});

describe('applyTransition', () => {
  test('accepting moves the due date to the submit window and keeps the referrer on the hook', () => {
    const out = applyTransition(req(), 'accepted', 'referrer', NOW);
    expect(out.state).toBe('accepted');
    expect(out.stateOwner).toBe('referrer');
    expect(out.nextUpdateDue).toBe(NOW + 14 * DAY_MS);
  });

  test('submitting hands ownership to the seeker', () => {
    const accepted = req({ state: 'accepted', stateOwner: 'referrer' });
    const out = applyTransition(accepted, 'submitted', 'referrer', NOW);
    expect(out.stateOwner).toBe('seeker');
  });

  test('a terminal transition clears the owner, the due date and the nudge count', () => {
    const out = applyTransition(req({ state: 'submitted', stateOwner: 'seeker', nudgeCount: 2 }), 'offer', 'seeker', NOW);
    expect(out.stateOwner).toBeNull();
    expect(out.nextUpdateDue).toBeNull();
    expect(out.nudgeCount).toBe(0);
  });

  test('declining requires a reason and records it', () => {
    const out = applyTransition(req(), 'declined', 'referrer', NOW, { declineReason: 'no_capacity' });
    expect(out.declineReason).toBe('no_capacity');
    expect(() => applyTransition(req(), 'declined', 'referrer', NOW)).toThrow(RuleViolation);
  });

  test('an illegal transition is refused, not corrected', () => {
    expect(() => applyTransition(req(), 'submitted', 'referrer', NOW)).toThrow(RuleViolation);
  });

  test('the wrong actor is refused', () => {
    expect(() => applyTransition(req(), 'accepted', 'seeker', NOW)).toThrow(RuleViolation);
  });

  test('applyTransition does not mutate its input', () => {
    const original = req();
    applyTransition(original, 'accepted', 'referrer', NOW);
    expect(original.state).toBe('sent');
  });

  test('role_closed returns the seeker to the directory and is not a decline (§8)', () => {
    const out = applyTransition(req({ state: 'accepted' }), 'role_closed', 'referrer', NOW);
    expect(out.state).toBe('role_closed');
    expect(out.declineReason).toBeNull();
  });
});
