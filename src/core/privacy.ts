/**
 * Viewer-scoped visibility (D2, D6).
 *
 * This is the stand-in for the row-level security PRD §9 puts in Postgres. It
 * is expressed as filters rather than guards because the failure mode of a
 * guard is an exception a caller can swallow, while the failure mode of a
 * filter is an empty list — which is the correct answer for someone who may
 * not see a thing. D2 is explicit that an unverified account sees nothing:
 * that is not a redirect to a sign-up page, it is an empty result.
 */
import type { Member, ReferralRequest } from '../data/schema.ts';

export function isVerified(m: Member | null): boolean {
  return Boolean(m && m.status === 'verified');
}

export function canSeeNetwork(m: Member | null): boolean {
  return isVerified(m);
}

/**
 * A seeker's confidentiality is enforced on the *target*, not the viewer:
 * Karan (§4) blocks his employer, and it is his record that must refuse to be
 * rendered, wherever it is asked for.
 */
export function canSeeMember(viewer: Member | null, target: Member): boolean {
  if (!canSeeNetwork(viewer)) return false;
  if (viewer!.id === target.id) return true;
  if (viewer!.isAdmin) return true;
  if (target.privacy.blockedMemberIds.includes(viewer!.id)) return false;
  if (viewer!.companyId && target.privacy.blockedCompanyIds.includes(viewer!.companyId)) return false;
  return true;
}

export function visibleMembers(viewer: Member | null, all: Member[]): Member[] {
  if (!canSeeNetwork(viewer)) return [];
  return all.filter((m) => canSeeMember(viewer, m));
}

/** D6: a request is a private 1:1 object. Admins are the only third party. */
export function canSeeRequest(viewer: Member | null, r: ReferralRequest): boolean {
  if (!canSeeNetwork(viewer)) return false;
  return viewer!.isAdmin || viewer!.id === r.seekerId || viewer!.id === r.referrerId;
}

export function visibleRequests(viewer: Member | null, all: ReferralRequest[]): ReferralRequest[] {
  if (!canSeeNetwork(viewer)) return [];
  return all.filter((r) => canSeeRequest(viewer, r));
}

/** D13: contact details are members-only and never rendered to anyone else. */
export function canSeeContactDetails(viewer: Member | null): boolean {
  return canSeeNetwork(viewer);
}
