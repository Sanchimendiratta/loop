import { describe, expect, test } from 'vitest';
import { applicationPromptDue, autoAdvanceFor, nudgeDueFor } from '../src/core/nudges.ts';
import { DAY_MS } from '../src/core/time.ts';
import type { PostApplication, ReferralRequest } from '../src/data/schema.ts';

const NOW = Date.UTC(2026, 8, 16);
const at = (days: number) => NOW + days * DAY_MS;
const req = (over: Partial<ReferralRequest> = {}): ReferralRequest => ({
  id: 'r1', seekerId: 'm1', referrerId: 'm2', companyId: 'c1', jobPostId: null,
  roleUrl: null, roleTitle: 'PM', resumeVersionId: null, pitch: '', state: 'sent',
  stateOwner: 'referrer', declineReason: null, nextUpdateDue: null, nudgeCount: 0,
  lastNudgedAt: null, createdAt: NOW, updatedAt: NOW, ...over,
});

describe('nudging the right person (§5.2)', () => {
  test('a sent request nudges the referrer at day 3', () => {
    const n = nudgeDueFor(req(), at(3));
    expect(n.due).toBe(true);
    expect(n.target).toBe('referrer');
  });

  test('nothing is nudged before the first interval', () => {
    expect(nudgeDueFor(req(), at(2)).due).toBe(false);
  });

  test('a second nudge lands at day 6', () => {
    const afterFirst = req({ nudgeCount: 1, lastNudgedAt: at(3) });
    expect(nudgeDueFor(afterFirst, at(6)).due).toBe(true);
    expect(nudgeDueFor(afterFirst, at(5)).due).toBe(false);
  });

  test('an accepted request nudges the referrer at day 7', () => {
    const r = req({ state: 'accepted', stateOwner: 'referrer', updatedAt: NOW });
    expect(nudgeDueFor(r, at(7)).target).toBe('referrer');
    expect(nudgeDueFor(r, at(7)).due).toBe(true);
  });

  test('a submitted request nudges the seeker at 14, 30 and 45', () => {
    expect(nudgeDueFor(req({ state: 'submitted', stateOwner: 'seeker' }), at(14)).target).toBe('seeker');
    expect(nudgeDueFor(req({ state: 'submitted', stateOwner: 'seeker', nudgeCount: 1, lastNudgedAt: at(14) }), at(30)).due).toBe(true);
    expect(nudgeDueFor(req({ state: 'submitted', stateOwner: 'seeker', nudgeCount: 2, lastNudgedAt: at(30) }), at(45)).due).toBe(true);
  });

  test('a terminal request is never nudged', () => {
    expect(nudgeDueFor(req({ state: 'offer', stateOwner: null }), at(90)).due).toBe(false);
    expect(nudgeDueFor(req({ state: 'declined', stateOwner: null }), at(90)).target).toBeNull();
  });

  test('nudging stops after the maximum', () => {
    const exhausted = req({ state: 'submitted', stateOwner: 'seeker', nudgeCount: 3, lastNudgedAt: at(45) });
    expect(nudgeDueFor(exhausted, at(90)).due).toBe(false);
  });
});

describe('auto-advance', () => {
  test('no referrer response in 7 days expires the request (§5.2)', () => {
    expect(autoAdvanceFor(req(), at(7))).toBe('expired');
    expect(autoAdvanceFor(req(), at(6))).toBeNull();
  });

  test('accepted but never submitted lapses at day 14 (§8)', () => {
    const r = req({ state: 'accepted', stateOwner: 'referrer', updatedAt: NOW });
    expect(autoAdvanceFor(r, at(14))).toBe('expired_unsubmitted');
  });

  test('three ignored nudges auto-close a submitted request as no_response', () => {
    const ghosted = req({ state: 'submitted', stateOwner: 'seeker', nudgeCount: 3, lastNudgedAt: at(45), updatedAt: NOW });
    expect(autoAdvanceFor(ghosted, at(46))).toBe('no_response');
  });

  test('an accepted request does not lapse a day early', () => {
    // A negative at the boundary: with `>` instead of `>=` this passes anyway,
    // so the day-13 assertion is what actually pins it.
    const r = req({ state: 'accepted', stateOwner: 'referrer', updatedAt: NOW });
    expect(autoAdvanceFor(r, at(13))).toBeNull();
    expect(autoAdvanceFor(r, at(14))).toBe('expired_unsubmitted');
  });

  test('a ghosted request is not auto-closed on the same day as its last nudge', () => {
    // Guards the "one further day after the final nudge" rule; weakening it to
    // >= 0 would close the loop the instant the third nudge went out.
    const sameDay = req({ state: 'submitted', stateOwner: 'seeker', nudgeCount: 3, lastNudgedAt: at(45), updatedAt: NOW });
    expect(autoAdvanceFor(sameDay, at(45))).toBeNull();
    expect(autoAdvanceFor(sameDay, at(46))).toBe('no_response');
  });

  test('a seeker who has not exhausted their nudges is not auto-closed', () => {
    const r = req({ state: 'submitted', stateOwner: 'seeker', nudgeCount: 1, lastNudgedAt: at(14), updatedAt: NOW });
    expect(autoAdvanceFor(r, at(20))).toBeNull();
  });

  test('a terminal request never auto-advances', () => {
    expect(autoAdvanceFor(req({ state: 'expired', stateOwner: null }), at(999))).toBeNull();
  });
});

describe('the job-post outcome prompt (§5.1)', () => {
  const app = (over: Partial<PostApplication> = {}): PostApplication => ({
    id: 'a1', jobPostId: 'p1', memberId: 'm1', appliedAt: NOW,
    outcome: 'unknown', outcomeAt: null, promptedAt: null, ...over,
  });

  test('the prompt is due at day 14', () => {
    expect(applicationPromptDue(app(), at(14))).toBe(true);
    expect(applicationPromptDue(app(), at(13))).toBe(false);
  });

  test('an answered application is never prompted again', () => {
    expect(applicationPromptDue(app({ outcome: 'rejected', outcomeAt: at(5) }), at(30))).toBe(false);
  });

  test('the prompt fires only once', () => {
    expect(applicationPromptDue(app({ promptedAt: at(14) }), at(30))).toBe(false);
  });
});
