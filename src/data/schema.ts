/**
 * Lite's six tables (spec §8, Lite §7).
 *
 * `verification_case` is folded into `member`: Lite has no appeals, and §7 says
 * a separate table only once appeals exist. `notification.emailed_at` is
 * reserved and unused so email can be switched on later without rework, and
 * `notification.pushed_at` is reserved the same way: a real backend actually
 * delivering a web push would stamp it, and nothing in this build does —
 * `store.savePushSubscription` records an endpoint, but nothing ever sends to
 * it.
 */

export const CONNECTIONS = ['hiring', 'works_here', 'knows_contact', 'forwarded'] as const;
export type Connection = (typeof CONNECTIONS)[number];

export const APPLICATION_STATUSES = [
  'yet_to_respond', 'in_review', 'interview_scheduled', 'awaiting_next_round',
  'offer', 'rejected', 'no_response',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Nothing follows these. The ladder stops; the row stays on the sheet. */
export const TERMINAL_APPLICATION_STATUSES: ApplicationStatus[] = ['offer', 'rejected', 'no_response'];

export const POST_STATUSES = ['open', 'filled', 'unsure'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const APPLY_METHODS = ['link', 'email', 'phone', 'through_me'] as const;
export type ApplyMethod = (typeof APPLY_METHODS)[number];

export const PROGRAMMES = ['BM', 'HRM', 'GMP', 'PGDM (GM)', 'FPM', 'Other'] as const;
export type Programme = (typeof PROGRAMMES)[number];

export const FUNCTIONS = [
  'HR', 'Marketing & Brand', 'Sales & BD', 'Finance', 'Strategy & Consulting',
  'Operations & Supply Chain', 'Product & Program', 'Analytics & Data',
  'General Management', 'Other',
] as const;
export type FunctionArea = (typeof FUNCTIONS)[number];

export type MemberStatus = 'pending' | 'verified' | 'rejected';
export type VerifiedBy = 'domain' | 'admin';
export type NotificationKind = 'applied_to_your_post' | 'you_were_verified' | 'post_filled';

export interface Member {
  id: string;
  googleSub: string;
  email: string;
  name: string;
  batch: number;
  programme: Programme;
  linkedinUrl: string;
  /** Optional fifth field (Lite §3) — a second thread to pull on a thin profile. */
  knownBy: string | null;
  verifiedBy: VerifiedBy | null;
  status: MemberStatus;
  isAdmin: boolean;
  requestedAt: number;
  decidedAt: number | null;
  decidedById: string | null;
  decisionNote: string;
}

export interface JobPost {
  id: string;
  posterId: string;
  title: string;
  companyName: string | null;
  isConfidential: boolean;
  confidentialDescriptor: string | null;
  function: FunctionArea;
  location: string;
  isRemote: boolean;
  expMin: number;
  expMax: number;
  compText: string | null;
  applyMethod: ApplyMethod;
  applyValue: string;
  jdUrl: string | null;
  note: string | null;
  connection: Connection;
  /** Named only when `connection` is `knows_contact`; shown in the line, never the value. */
  contactName: string | null;
  rawPaste: string | null;
  postedAt: number;
  postStatus: PostStatus;
  lastConfirmedAt: number;
}

export interface Application {
  id: string;
  jobPostId: string;
  memberId: string;
  appliedAt: number;
  status: ApplicationStatus;
  statusUpdatedAt: number;
}

export interface Notification {
  id: string;
  memberId: string;
  kind: NotificationKind;
  body: string;
  link: string;
  readAt: number | null;
  /** Reserved. Unused in Lite — a real backend delivering a push would stamp this; nothing in this build does. */
  pushedAt: number | null;
  /** Reserved. Unused in Lite so email can be switched on without rework (§5). */
  emailedAt: number | null;
  at: number;
}

export interface PushSubscription {
  id: string;
  memberId: string;
  endpoint: string;
  keys: string;
  createdAt: number;
}

export interface Report {
  id: string;
  jobPostId: string;
  reporterId: string;
  reason: string;
  at: number;
  resolvedAt: number | null;
}

export const SCHEMA_VERSION = 1;
