/**
 * Entity shapes and enums, mirroring PRD §9's data model.
 *
 * `school` exists with exactly one row and no UI (D7): opening the network to
 * another institute later is a config row, not a migration.
 */

export type PosterRelationship = 'hiring_manager' | 'internal_can_refer' | 'knows_contact' | 'forwarded';
export type DestinationType = 'company_ats' | 'named_person' | 'external_recruiter' | 'third_party_platform' | 'via_poster';
export type ApplyMethod = 'link' | 'email' | 'phone' | 'via_loop';
export type ConfirmState = 'open' | 'filled' | 'unknown';
export type VerificationTier = 'A' | 'B' | 'C';
export type MemberStatus = 'unverified' | 'pending' | 'verified' | 'rejected' | 'suspended';
export type DeclineReason = 'not_a_fit' | 'no_capacity' | 'dont_know_you' | 'role_closed';
export type ApplicationOutcome = 'unknown' | 'no_response' | 'rejected' | 'responded' | 'interviewing' | 'offer';

/** D16: the rung both badges the card and orders the board. */
export const RELATIONSHIP_RANK: Record<PosterRelationship, number> = {
  hiring_manager: 1,
  internal_can_refer: 2,
  knows_contact: 3,
  forwarded: 4,
};

export const REQUEST_STATES = [
  'sent', 'declined', 'accepted', 'submitted', 'recruiter_contact',
  'interviewing', 'offer', 'rejected', 'no_response', 'expired',
  'expired_unsubmitted', 'role_closed',
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const TERMINAL_REQUEST_STATES: RequestState[] = [
  'declined', 'offer', 'rejected', 'no_response', 'expired', 'expired_unsubmitted', 'role_closed',
];

export interface School {
  id: string;
  name: string;
  verifiedDomains: string[];
}

export interface PrivacySettings {
  /** D6: nothing about a seeker is public. Kept as a field so the default is visible in data, not implied by absence. */
  confidentialSearch: boolean;
  blockedCompanyIds: string[];
  blockedMemberIds: string[];
}

export interface Member {
  id: string;
  schoolId: string;
  googleSub: string;
  email: string;
  name: string;
  batch: number;
  programme: string;
  status: MemberStatus;
  tier: VerificationTier | null;
  isAdmin: boolean;
  companyId: string | null;
  title: string | null;
  function: string | null;
  location: string | null;
  linkedinUrl: string | null;
  openToReferring: boolean;
  caps: { maxOpen: number; maxPerMonth: number; paused: boolean; autoDeclineMessage: string };
  privacy: PrivacySettings;
  resumeVersionId: string | null;
  joinedAt: number;
}

export interface VerificationCase {
  id: string;
  memberId: string;
  tier: VerificationTier;
  evidence: { linkedinUrl: string; batch: number; programme: string; nameAtGraduation: string };
  decision: 'pending' | 'approved' | 'rejected' | 'more_info';
  reviewerId: string | null;
  decidedAt: number | null;
  notes: string;
  isAppeal: boolean;
  submittedAt: number;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
}

export interface JobPost {
  id: string;
  posterId: string;
  companyId: string | null;
  confidentialDescriptor: string | null;
  title: string;
  locations: string[];
  expMin: number | null;
  expMax: number | null;
  compText: string | null;
  function: string | null;
  applyMethod: ApplyMethod;
  applyValue: string;
  jdUrl: string | null;
  posterRelationship: PosterRelationship;
  destinationType: DestinationType;
  hiringContactName: string | null;
  hiringContactValue: string | null;
  contactConsentConfirmed: boolean;
  contactRemovalRequestedAt: number | null;
  rawText: string;
  parseConfidence: number;
  dedupeHash: string;
  postedAt: number;
  lastConfirmedAt: number;
  confirmState: ConfirmState;
  archivedAt: number | null;
  viewCount: number;
  /** Three "couldn't reach this contact" flags mark the route unverified (§8). */
  unreachableFlags: string[];
  reportedBy: string[];
}

/** A merged duplicate: the same role posted by another alum (§5.1). */
export interface PostShare {
  id: string;
  jobPostId: string;
  sharerId: string;
  at: number;
}

export interface PostApplication {
  id: string;
  jobPostId: string;
  memberId: string;
  appliedAt: number;
  outcome: ApplicationOutcome;
  outcomeAt: number | null;
  promptedAt: number | null;
}

export interface ReferralRequest {
  id: string;
  seekerId: string;
  referrerId: string;
  companyId: string;
  jobPostId: string | null;
  roleUrl: string | null;
  roleTitle: string;
  resumeVersionId: string | null;
  pitch: string;
  state: RequestState;
  /** Stored, never inferred: the tracker and the nudge engine must not disagree. */
  stateOwner: 'seeker' | 'referrer' | null;
  declineReason: DeclineReason | null;
  nextUpdateDue: number | null;
  nudgeCount: number;
  lastNudgedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Append-only. The audit trail and the dataset (PRD §9). */
export interface RequestEvent {
  id: string;
  requestId: string;
  actorId: string | null;
  fromState: RequestState | null;
  toState: RequestState;
  note: string;
  at: number;
}

export interface ResumeVersion {
  id: string;
  memberId: string;
  filename: string;
  uploadedAt: number;
}

export interface Vouch {
  id: string;
  caseId: string;
  voucherId: string;
  at: number;
}

export interface Report {
  id: string;
  reporterId: string;
  targetType: 'post' | 'member';
  targetId: string;
  reason: string;
  at: number;
  resolvedAt: number | null;
}

export const SCHEMA_VERSION = 1;

/** Tier C unlocks only once the network can sustain it (§6). */
export const VOUCHING_UNLOCK_THRESHOLD = 200;
