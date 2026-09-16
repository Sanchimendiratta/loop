import { describe, expect, test } from 'vitest';
import { duplicateSubmissionGuard, intakeCheck, openRequestsFor, referralsThisMonth } from '../src/core/capacity.ts';
import { DAY_MS } from '../src/core/time.ts';
import type { Member, ReferralRequest } from '../src/data/schema.ts';

const NOW = Date.UTC(2026, 8, 16);
const referrer = (over: Partial<Member> = {}): Member => ({
  id: 'm2', schoolId: 's1', googleSub: 'g', email: 'r@x.com', name: 'Rohit', batch: 2019,
  programme: 'HRM', status: 'verified', tier: 'B', isAdmin: false, companyId: 'c1',
  title: 'HRBP', function: 'HR', location: 'Mumbai', linkedinUrl: null, openToReferring: true,
  caps: { maxOpen: 2, maxPerMonth: 3, paused: false, autoDeclineMessage: 'Swamped this month.' },
  privacy: { confidentialSearch: true, blockedCompanyIds: [], blockedMemberIds: [] },
  resumeVersionId: null, joinedAt: 0, ...over,
});
const req = (over: Partial<ReferralRequest> = {}): ReferralRequest => ({
  id: 'r1', seekerId: 'm1', referrerId: 'm2', companyId: 'c1', jobPostId: null, roleUrl: null,
  roleTitle: 'PM', resumeVersionId: null, pitch: '', state: 'sent', stateOwner: 'referrer',
  declineReason: null, nextUpdateDue: null, nudgeCount: 0, lastNudgedAt: null,
  createdAt: NOW, updatedAt: NOW, ...over,
});

describe('referrer intake caps (§7.1)', () => {
  test('open requests exclude terminal ones', () => {
    const all = [req({ id: 'a' }), req({ id: 'b', state: 'declined', stateOwner: null }), req({ id: 'c', state: 'accepted' })];
    expect(openRequestsFor('m2', all).map((r) => r.id)).toEqual(['a', 'c']);
  });

  test('a referrer under their caps is accepting', () => {
    expect(intakeCheck(referrer(), [req()], NOW).accepting).toBe(true);
  });

  test('hitting maxOpen stops intake', () => {
    const all = [req({ id: 'a' }), req({ id: 'b' })];
    const check = intakeCheck(referrer(), all, NOW);
    expect(check.accepting).toBe(false);
    expect(check.reason).toBe('at_capacity');
  });

  test('pausing stops intake and surfaces the auto-decline message', () => {
    const check = intakeCheck(referrer({ caps: { maxOpen: 9, maxPerMonth: 9, paused: true, autoDeclineMessage: 'On leave.' } }), [], NOW);
    expect(check.accepting).toBe(false);
    expect(check.reason).toBe('paused');
    expect(check.autoDeclineMessage).toBe('On leave.');
  });

  test('a referrer not open to referring is not accepting', () => {
    expect(intakeCheck(referrer({ openToReferring: false }), [], NOW).reason).toBe('not_open');
  });

  test('the monthly cap counts submissions in the last 30 days', () => {
    const all = [
      req({ id: 'a', state: 'submitted', stateOwner: 'seeker', updatedAt: NOW - 5 * DAY_MS }),
      req({ id: 'b', state: 'submitted', stateOwner: 'seeker', updatedAt: NOW - 10 * DAY_MS }),
      req({ id: 'c', state: 'submitted', stateOwner: 'seeker', updatedAt: NOW - 40 * DAY_MS }),
    ];
    expect(referralsThisMonth('m2', all, NOW)).toBe(2);
  });

  test('hitting the monthly cap stops intake', () => {
    // maxOpen is raised so this isolates the monthly cap: `submitted` is not a
    // terminal state, so three of them would otherwise trip `at_capacity` first.
    const roomy = referrer({ caps: { maxOpen: 9, maxPerMonth: 3, paused: false, autoDeclineMessage: '' } });
    const all = [1, 2, 3].map((i) => req({ id: `s${i}`, state: 'submitted', stateOwner: 'seeker', updatedAt: NOW - i * DAY_MS }));
    expect(intakeCheck(roomy, all, NOW).reason).toBe('monthly_cap');
  });
});

describe('the one retained guard (spec DL1)', () => {
  test('a second submission of the same seeker to the same role is caught', () => {
    const existing = [req({ id: 'x', state: 'submitted', stateOwner: 'seeker', seekerId: 'm1', companyId: 'c1', roleTitle: 'Product Manager' })];
    expect(duplicateSubmissionGuard('m1', 'c1', 'product manager', existing)?.id).toBe('x');
  });

  test('a different role at the same company is fine', () => {
    const existing = [req({ id: 'x', state: 'submitted', stateOwner: 'seeker', roleTitle: 'Product Manager' })];
    expect(duplicateSubmissionGuard('m1', 'c1', 'Head of Ops', existing)).toBeNull();
  });

  test('an un-submitted request at the same role does NOT block — only a real submission does', () => {
    const existing = [req({ id: 'x', state: 'sent', roleTitle: 'Product Manager' })];
    expect(duplicateSubmissionGuard('m1', 'c1', 'Product Manager', existing)).toBeNull();
  });

  test('a seeker may hold many open requests at one company (DL1)', () => {
    const existing = [req({ id: 'a' }), req({ id: 'b' }), req({ id: 'c' })];
    expect(duplicateSubmissionGuard('m1', 'c1', 'Something Else', existing)).toBeNull();
  });
});
