import { describe, expect, test } from 'vitest';
import {
  canSeeContactDetails, canSeeMember, canSeeNetwork, canSeeRequest,
  isVerified, visibleMembers, visibleRequests,
} from '../src/core/privacy.ts';
import type { Member, ReferralRequest } from '../src/data/schema.ts';

const member = (over: Partial<Member> = {}): Member => ({
  id: 'm1', schoolId: 's1', googleSub: 'g1', email: 'a@astra.xlri.ac.in', name: 'Ananya',
  batch: 2026, programme: 'BM', status: 'verified', tier: 'A', isAdmin: false,
  companyId: null, title: null, function: null, location: null, linkedinUrl: null,
  openToReferring: false,
  caps: { maxOpen: 5, maxPerMonth: 3, paused: false, autoDeclineMessage: '' },
  privacy: { confidentialSearch: true, blockedCompanyIds: [], blockedMemberIds: [] },
  resumeVersionId: null, joinedAt: 0, ...over,
});

const request = (over: Partial<ReferralRequest> = {}): ReferralRequest => ({
  id: 'r1', seekerId: 'm1', referrerId: 'm2', companyId: 'c1', jobPostId: null,
  roleUrl: null, roleTitle: 'PM', resumeVersionId: null, pitch: '', state: 'sent',
  stateOwner: 'referrer', declineReason: null, nextUpdateDue: null, nudgeCount: 0,
  lastNudgedAt: null, createdAt: 0, updatedAt: 0, ...over,
});

describe('privacy (D2, D6)', () => {
  test('an unverified member sees nothing', () => {
    const u = member({ status: 'pending', tier: null });
    expect(canSeeNetwork(u)).toBe(false);
    expect(visibleMembers(u, [member({ id: 'm2' })])).toEqual([]);
  });

  test('a signed-out viewer sees nothing', () => {
    expect(canSeeNetwork(null)).toBe(false);
    expect(visibleMembers(null, [member()])).toEqual([]);
  });

  test('a suspended member loses visibility', () => {
    expect(isVerified(member({ status: 'suspended' }))).toBe(false);
  });

  test('a verified member sees other verified members', () => {
    const viewer = member({ id: 'm1' });
    const other = member({ id: 'm2' });
    expect(canSeeMember(viewer, other)).toBe(true);
  });

  test('a seeker who blocked a member is hidden from them', () => {
    const viewer = member({ id: 'm2' });
    const blocker = member({ id: 'm1', privacy: { confidentialSearch: true, blockedCompanyIds: [], blockedMemberIds: ['m2'] } });
    expect(canSeeMember(viewer, blocker)).toBe(false);
  });

  test('a seeker who blocked a company is hidden from its employees', () => {
    const viewer = member({ id: 'm2', companyId: 'c9' });
    const blocker = member({ id: 'm1', privacy: { confidentialSearch: true, blockedCompanyIds: ['c9'], blockedMemberIds: [] } });
    expect(canSeeMember(viewer, blocker)).toBe(false);
  });

  test('a request is readable by exactly its two parties', () => {
    const r = request();
    expect(canSeeRequest(member({ id: 'm1' }), r)).toBe(true);
    expect(canSeeRequest(member({ id: 'm2' }), r)).toBe(true);
    expect(canSeeRequest(member({ id: 'm3' }), r)).toBe(false);
  });

  test('an admin can read any request', () => {
    expect(canSeeRequest(member({ id: 'm9', isAdmin: true }), request())).toBe(true);
  });

  test('an unverified admin still sees nothing — verification gates everything', () => {
    const u = member({ id: 'm9', isAdmin: true, status: 'pending' });
    expect(canSeeRequest(u, request())).toBe(false);
  });

  test('visibleRequests filters rather than throwing', () => {
    const all = [request({ id: 'r1' }), request({ id: 'r2', seekerId: 'm7', referrerId: 'm8' })];
    expect(visibleRequests(member({ id: 'm1' }), all).map((r) => r.id)).toEqual(['r1']);
  });

  test('contact details need a verified viewer (D13)', () => {
    expect(canSeeContactDetails(member())).toBe(true);
    expect(canSeeContactDetails(member({ status: 'pending' }))).toBe(false);
    expect(canSeeContactDetails(null)).toBe(false);
  });
});
