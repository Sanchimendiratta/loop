/**
 * The repository boundary.
 *
 * The only module that touches persistence, and the only place four rules live
 * (spec §4.1): the privacy filter, the duplicate-submission guard, referrer
 * capacity, and state transitions. They are here rather than in the screens
 * because a rule enforced in a dialog is a suggestion — any other code path
 * walks straight past it.
 *
 * Swapping this for Supabase means reimplementing this file against Postgres
 * with RLS, and changing nothing above it. That is the entire reason the read
 * functions take a viewer instead of the screens filtering afterwards.
 */
import { buildSeed } from './seed.ts';
import type { AppState } from './seed.ts';
import { SCHEMA_VERSION } from './schema.ts';
import type {
  ApplicationOutcome,
  ApplyMethod,
  Company,
  ConfirmState,
  DeclineReason,
  DestinationType,
  JobPost,
  Member,
  PostApplication,
  PostShare,
  PosterRelationship,
  PrivacySettings,
  ReferralRequest,
  Report,
  RequestEvent,
  RequestState,
  VerificationCase,
} from './schema.ts';
import {
  canSeeMember,
  canSeeNetwork,
  canSeeRequest,
  visibleMembers,
  visibleRequests,
} from '../core/privacy.ts';
import {
  applyTransition,
  canTransition,
  isTerminal,
  OWNER_BY_STATE,
  RESPONSE_WINDOW_DAYS,
  RuleViolation,
} from '../core/requests.ts';
import { duplicateSubmissionGuard, intakeCheck } from '../core/capacity.ts';
import { CONFIRM_PROMPT_DAYS, freshnessFor } from '../core/freshness.ts';
import { sortPosts } from '../core/rank.ts';
import { dedupeHash } from '../core/dedupe.ts';
import { APPLICATION_PROMPT_DAY, applicationPromptDue, autoAdvanceFor, nudgeDueFor } from '../core/nudges.ts';
import { decideCase } from '../core/verification.ts';
import { addDays, daysBetween } from '../core/time.ts';

// ---------------------------------------------------------------------------
// Public draft / projection shapes
// ---------------------------------------------------------------------------

export interface PostDraft {
  rawText: string;
  title: string;
  companyId: string | null;
  confidentialDescriptor: string | null;
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
  parseConfidence: number;
}

export interface RequestDraft {
  referrerId: string;
  companyId: string;
  roleTitle: string;
  pitch: string;
  roleUrl: string | null;
  jobPostId: string | null;
}

export interface PostStats {
  views: number;
  applied: number;
  heardBack: number;
  interviewing: number;
  outcomesUnknown: boolean;
}

export interface TrackerRow {
  id: string;
  kind: 'request' | 'application' | 'post';
  title: string;
  subtitle: string;
  counterpartyName: string | null;
  state: string;
  owed: 'you' | 'them' | 'nobody';
  dueAt: number | null;
  overdueDays: number;
  cta: { label: string; action: string } | null;
}

export interface LoadOptions {
  /** Injectable clock. Every seeded fixture is positioned relative to this. */
  now?: number;
  /**
   * Whether to catch the demo up on time elapsed since it was written
   * (requirement 7). True on `load` — a browser session returning after a week
   * should not show a request that expired six days ago as still open.
   */
  runClockOnLoad?: boolean;
}

// ---------------------------------------------------------------------------
// Persistence + subscription
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'loop.state.v1';

let state: AppState | null = null;
const listeners = new Set<() => void>();

/**
 * `localStorage` is a browser global. Under Vitest (environment: 'node') the
 * identifier does not exist at all, so every access is guarded by `typeof`
 * rather than by a truthiness check — referencing an undeclared global throws
 * a ReferenceError, which no `if (localStorage)` can catch.
 */
function storage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage;
  } catch {
    // Safari in private mode, and any browser with site data blocked.
    return null;
  }
}

function persist(): void {
  const store = storage();
  if (!store || !state) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full quota must not take a write down with it: the in-memory state is
    // still correct, and the next commit will try again.
  }
}

function notify(): void {
  for (const fn of [...listeners]) fn();
}

/** Persist, then notify. The UI hook in Task 16 depends on exactly this order. */
function commit(): void {
  persist();
  notify();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function load(opts: LoadOptions = {}): AppState {
  const now = opts.now ?? Date.now();
  const store = storage();
  let loaded: AppState | null = null;

  if (store) {
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppState | null;
        // A schema-version mismatch reseeds rather than migrating: this is
        // demo data, and a half-migrated demo is worse than a fresh one.
        if (parsed && parsed.version === SCHEMA_VERSION && Array.isArray(parsed.members)) {
          loaded = parsed;
        }
      }
    } catch {
      loaded = null;
    }
  }

  state = loaded ?? buildSeed(now);
  if (opts.runClockOnLoad ?? true) runClock(now);
  commit();
  return state;
}

/**
 * A fresh workspace holding the demo exactly as authored.
 *
 * Deliberately does NOT run the clock. `buildSeed` positions its fixtures
 * relative to `now` — an un-answered request sitting 10 days with its referrer,
 * a post stale by 35 days — and running the clock over them at reset would
 * consume the very states the demo exists to show before anyone saw them.
 * Catching up on elapsed time is `load`'s job, not a reset's.
 */
export function reset(now: number = Date.now()): AppState {
  state = buildSeed(now);
  commit();
  return state;
}

export function getState(): AppState {
  if (!state) load();
  return state as AppState;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

let idSeq = 0;

/** Unique within a session and stable across a reload; never `Math.random`. */
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}_${Date.now().toString(36)}${idSeq.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export function getCurrentMember(): Member | null {
  const s = getState();
  return s.members.find((m) => m.id === s.currentMemberId) ?? null;
}

export function setCurrentMember(id: string): void {
  const s = getState();
  const member = s.members.find((m) => m.id === id);
  if (!member) throw new RuleViolation('No such member.', 'unknown_member');
  s.currentMemberId = id;
  commit();
}

/**
 * Rule 1 — the privacy filter. Every read in this file begins here.
 *
 *   const viewer = getCurrentMember();
 *   if (!canSeeNetwork(viewer)) return [];
 *
 * D2 is explicit that an unverified account sees nothing, and that this is an
 * empty result rather than a redirect. There is NO admin exception: an admin
 * whose own membership lapsed reads nothing either, and `canSeeMember` gives
 * admins no bypass of a seeker's block (see `core/privacy.ts`).
 */
function viewerOrNull(): Member | null {
  const viewer = getCurrentMember();
  if (!canSeeNetwork(viewer)) return null;
  return viewer;
}

/** The same guard for writes, where the honest answer is a refusal. */
function requireViewer(): Member {
  const viewer = viewerOrNull();
  if (!viewer) {
    throw new RuleViolation('Your membership is not verified yet.', 'not_verified');
  }
  return viewer;
}

// ---------------------------------------------------------------------------
// Reads — all viewer-scoped
// ---------------------------------------------------------------------------

/** A post whose poster is invisible to the viewer is invisible too: a blocked
 * member must not be discoverable via their own posts (§6/D6). */
function postsVisibleTo(viewer: Member, s: AppState): JobPost[] {
  const byId = new Map(s.members.map((m) => [m.id, m]));
  return s.posts.filter((p) => {
    const poster = byId.get(p.posterId);
    return poster ? canSeeMember(viewer, poster) : false;
  });
}

export function listPosts(now: number): JobPost[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  return sortPosts(postsVisibleTo(viewer, getState()), now);
}

export function getPost(id: string): JobPost | null {
  const viewer = viewerOrNull();
  if (!viewer) return null;
  return postsVisibleTo(viewer, getState()).find((p) => p.id === id) ?? null;
}

/**
 * The visible roster, unfiltered by status: a pending or suspended member is
 * still a row an admin console and a moderation view need to render. Screens
 * wanting "alumni you could ask" want `alumniAt`.
 */
export function listMembers(): Member[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  return visibleMembers(viewer, getState().members);
}

export function getMember(id: string): Member | null {
  const viewer = viewerOrNull();
  if (!viewer) return null;
  const target = getState().members.find((m) => m.id === id);
  if (!target) return null;
  return canSeeMember(viewer, target) ? target : null;
}

export function listCompanies(): Company[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  return [...getState().companies];
}

/** Verified, visible alumni at one company — the referrer picker's source. */
export function alumniAt(companyId: string): Member[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  return visibleMembers(viewer, getState().members).filter(
    (m) => m.companyId === companyId && m.status === 'verified',
  );
}

export function listRequests(): ReferralRequest[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  return visibleRequests(viewer, getState().requests);
}

export function getRequest(id: string): ReferralRequest | null {
  const viewer = viewerOrNull();
  if (!viewer) return null;
  const req = getState().requests.find((r) => r.id === id);
  if (!req) return null;
  return canSeeRequest(viewer, req) ? req : null;
}

export function requestEventsFor(id: string): RequestEvent[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  const s = getState();
  const req = s.requests.find((r) => r.id === id);
  // The timeline inherits the request's visibility; it is the same private
  // 1:1 object seen end-on.
  if (!req || !canSeeRequest(viewer, req)) return [];
  return s.requestEvents.filter((e) => e.requestId === id).sort((a, b) => a.at - b.at);
}

/**
 * The admin verification queue.
 *
 * Deliberately NOT filtered through `canSeeMember`. That function grants
 * admins no bypass of a seeker's block — by ruling, a seeker's block binds
 * admins too — so sourcing this queue through member visibility would make a
 * blocking member unreviewable. A submitted case carries its own implicit
 * consent: the member handed over the evidence and asked to be checked.
 */
export function listCases(): VerificationCase[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  if (!viewer.isAdmin) return [];
  return [...getState().cases].sort((a, b) => a.submittedAt - b.submittedAt);
}

/**
 * The viewer's own applications to a post, plus — if they posted it, or hold an
 * admin seat — everyone else's, still filtered through `canSeeMember` so a
 * blocked applicant stays blocked.
 */
export function applicationsFor(postId: string): PostApplication[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  const s = getState();
  const post = s.posts.find((p) => p.id === postId);
  if (!post) return [];
  const mine = s.applications.filter((a) => a.jobPostId === postId && a.memberId === viewer.id);
  if (post.posterId !== viewer.id && !viewer.isAdmin) return mine;
  const byId = new Map(s.members.map((m) => [m.id, m]));
  return s.applications.filter((a) => {
    if (a.jobPostId !== postId) return false;
    if (a.memberId === viewer.id) return true;
    const applicant = byId.get(a.memberId);
    return applicant ? canSeeMember(viewer, applicant) : false;
  });
}

/** Aggregate counts only — no identity leaves this function (§8). */
export function posterStatsFor(postId: string): PostStats {
  const empty: PostStats = { views: 0, applied: 0, heardBack: 0, interviewing: 0, outcomesUnknown: true };
  const viewer = viewerOrNull();
  if (!viewer) return empty;
  const s = getState();
  const post = s.posts.find((p) => p.id === postId);
  if (!post) return empty;
  const apps = s.applications.filter((a) => a.jobPostId === postId);
  const heardBackOutcomes: ApplicationOutcome[] = ['responded', 'interviewing', 'offer', 'rejected'];
  return {
    views: post.viewCount,
    applied: apps.length,
    heardBack: apps.filter((a) => heardBackOutcomes.includes(a.outcome)).length,
    interviewing: apps.filter((a) => a.outcome === 'interviewing').length,
    // §8: a post nobody has reported back on says so, rather than implying
    // silence means rejection.
    outcomesUnknown: apps.every((a) => a.outcome === 'unknown'),
  };
}

const DIGEST_WINDOW_DAYS = 1;
const APP_ORIGIN = 'https://loop.alumni';

function postLink(id: string): string {
  const origin = typeof location === 'undefined' ? APP_ORIGIN : location.origin;
  return `${origin}/post/${id}`;
}

function companyLabel(post: JobPost, s: AppState): string {
  if (post.companyId) {
    return s.companies.find((c) => c.id === post.companyId)?.name ?? 'Undisclosed';
  }
  return post.confidentialDescriptor ?? 'Undisclosed';
}

/**
 * D17: a block of text a human copies into the WhatsApp group. Nothing here
 * posts anywhere — the integration is a person and their clipboard, which is
 * why every line has to stand alone with a link on it.
 */
export function whatsappDigest(now: number): string {
  const viewer = viewerOrNull();
  if (!viewer) return '';
  const s = getState();
  const fresh = postsVisibleTo(viewer, s)
    .filter((p) => p.archivedAt === null && daysBetween(p.postedAt, now) < DIGEST_WINDOW_DAYS)
    .sort((a, b) => b.postedAt - a.postedAt);

  const header =
    fresh.length === 0
      ? `${s.school.name} on Loop — no new roles in the last 24 hours.`
      : `${s.school.name} on Loop — ${fresh.length} new role${fresh.length === 1 ? '' : 's'} today:`;

  const lines = fresh.map((p) => `• ${p.title} — ${companyLabel(p, s)} — ${postLink(p.id)}`);
  return [header, ...lines].join('\n');
}

// ---------------------------------------------------------------------------
// Writes — posts
// ---------------------------------------------------------------------------

const CONSENT_REQUIRED_DESTINATIONS: DestinationType[] = ['named_person', 'external_recruiter'];

function livePostByHash(hash: string, s: AppState): JobPost | null {
  return (
    s.posts.find((p) => p.dedupeHash === hash && p.archivedAt === null && p.confirmState !== 'filled') ?? null
  );
}

export function publishPost(draft: PostDraft): JobPost {
  const viewer = requireViewer();
  const s = getState();
  const now = Date.now();

  // D13: the relationship rung is the one field a parser cannot fill, and the
  // one the whole board is ordered by. No default is honest, so there is none.
  if (!draft.posterRelationship) {
    throw new RuleViolation('Say how you know about this role.', 'missing_relationship');
  }
  if (!draft.title.trim()) {
    throw new RuleViolation('A post needs a role title.', 'missing_title');
  }
  if (!draft.applyValue.trim()) {
    throw new RuleViolation('A post needs somewhere to apply.', 'missing_apply_route');
  }
  // D13: a named third party's phone number is their data, not the poster's.
  if (CONSENT_REQUIRED_DESTINATIONS.includes(draft.destinationType) && !draft.contactConsentConfirmed) {
    throw new RuleViolation(
      'Confirm the contact is happy to be named before posting their details.',
      'missing_contact_consent',
    );
  }

  const hash = dedupeHash(draft.applyValue, draft.title);
  const existing = livePostByHash(hash, s);

  if (existing) {
    // §5.1: four alumni forwarding the same JD is corroboration, not clutter.
    // So a duplicate MERGES — it appends a share and hands back the post that
    // is already on the board, rather than inserting a second card.
    const alreadyShared =
      existing.posterId === viewer.id || s.shares.some((sh) => sh.jobPostId === existing.id && sh.sharerId === viewer.id);
    if (!alreadyShared) {
      const share: PostShare = {
        id: nextId('ps'),
        jobPostId: existing.id,
        sharerId: viewer.id,
        at: now,
      };
      s.shares = [...s.shares, share];
      commit();
    }
    return existing;
  }

  const post: JobPost = {
    id: nextId('p'),
    posterId: viewer.id,
    companyId: draft.companyId,
    confidentialDescriptor: draft.confidentialDescriptor,
    title: draft.title.trim(),
    locations: [...draft.locations],
    expMin: draft.expMin,
    expMax: draft.expMax,
    compText: draft.compText,
    function: draft.function,
    applyMethod: draft.applyMethod,
    applyValue: draft.applyValue.trim(),
    jdUrl: draft.jdUrl,
    posterRelationship: draft.posterRelationship,
    destinationType: draft.destinationType,
    hiringContactName: draft.hiringContactName,
    hiringContactValue: draft.hiringContactValue,
    contactConsentConfirmed: draft.contactConsentConfirmed,
    contactRemovalRequestedAt: null,
    rawText: draft.rawText,
    parseConfidence: draft.parseConfidence,
    dedupeHash: hash,
    postedAt: now,
    lastConfirmedAt: now,
    confirmState: 'open',
    archivedAt: null,
    viewCount: 0,
    unreachableFlags: [],
    reportedBy: [],
  };
  s.posts = [...s.posts, post];
  commit();
  return post;
}

function replacePost(next: JobPost): JobPost {
  const s = getState();
  s.posts = s.posts.map((p) => (p.id === next.id ? next : p));
  commit();
  return next;
}

function requirePostForWrite(postId: string, viewer: Member): JobPost {
  const post = getState().posts.find((p) => p.id === postId);
  if (!post) throw new RuleViolation('No such post.', 'unknown_post');
  if (!canSeeMember(viewer, getState().members.find((m) => m.id === post.posterId) ?? viewer)) {
    throw new RuleViolation('No such post.', 'unknown_post');
  }
  return post;
}

/** D14: "I don't know" resets the clock without asserting the role is open. */
export function confirmPost(postId: string, answer: ConfirmState): JobPost {
  const viewer = requireViewer();
  const post = requirePostForWrite(postId, viewer);
  if (post.posterId !== viewer.id && !viewer.isAdmin) {
    throw new RuleViolation('Only the person who posted a role can confirm it.', 'not_poster');
  }
  const now = Date.now();
  return replacePost({
    ...post,
    confirmState: answer,
    lastConfirmedAt: now,
    // A filled role leaves the board immediately — that is the entire point of
    // asking (§5.1).
    archivedAt: answer === 'filled' ? now : post.archivedAt,
  });
}

export function applyToPost(postId: string): PostApplication {
  const viewer = requireViewer();
  const post = requirePostForWrite(postId, viewer);
  const now = Date.now();
  const freshness = freshnessFor(post, now);
  if (freshness.state === 'archived' || freshness.state === 'filled') {
    throw new RuleViolation('This role is no longer on the board.', 'post_closed');
  }
  if (post.posterId === viewer.id) {
    throw new RuleViolation('You posted this role.', 'self_application');
  }
  const s = getState();
  const prior = s.applications.find((a) => a.jobPostId === postId && a.memberId === viewer.id);
  if (prior) throw new RuleViolation('You have already applied to this role.', 'already_applied');

  const application: PostApplication = {
    id: nextId('app'),
    jobPostId: postId,
    memberId: viewer.id,
    appliedAt: now,
    outcome: 'unknown',
    outcomeAt: null,
    promptedAt: null,
  };
  s.applications = [...s.applications, application];
  commit();
  return application;
}

export function recordOutcome(applicationId: string, outcome: ApplicationOutcome): PostApplication {
  const viewer = requireViewer();
  const s = getState();
  const application = s.applications.find((a) => a.id === applicationId);
  if (!application) throw new RuleViolation('No such application.', 'unknown_application');
  // §5.1: outcomes are self-reported and private to the applicant. Nobody
  // answers on anyone else's behalf, admins included.
  if (application.memberId !== viewer.id) {
    throw new RuleViolation('Only the applicant can record an outcome.', 'not_applicant');
  }
  const now = Date.now();
  const next: PostApplication = { ...application, outcome, outcomeAt: now, promptedAt: now };
  s.applications = s.applications.map((a) => (a.id === next.id ? next : a));
  commit();
  return next;
}

/** §8: three independent "couldn't reach this contact" flags mark the route
 * unverified. One disgruntled applicant is not evidence. */
export function flagUnreachable(postId: string): JobPost {
  const viewer = requireViewer();
  const post = requirePostForWrite(postId, viewer);
  if (post.unreachableFlags.includes(viewer.id)) return post;
  return replacePost({ ...post, unreachableFlags: [...post.unreachableFlags, viewer.id] });
}

/**
 * D13: a named contact who never asked to be on a job board can have their
 * details taken down. Honoured immediately rather than queued, because the
 * harm is the details being served, and a queue keeps serving them. A
 * `named_person` card is archived too: its only apply route WAS that person.
 */
export function requestContactRemoval(postId: string): JobPost {
  const viewer = requireViewer();
  const post = requirePostForWrite(postId, viewer);
  if (post.posterId !== viewer.id && !viewer.isAdmin) {
    throw new RuleViolation('Ask an admin to take a contact down.', 'not_poster');
  }
  const now = Date.now();
  return replacePost({
    ...post,
    contactRemovalRequestedAt: now,
    hiringContactName: null,
    hiringContactValue: null,
    contactConsentConfirmed: false,
    archivedAt: post.destinationType === 'named_person' ? now : post.archivedAt,
  });
}

// ---------------------------------------------------------------------------
// Writes — referral requests
// ---------------------------------------------------------------------------

function appendEvent(
  requestId: string,
  actorId: string | null,
  fromState: RequestState | null,
  toState: RequestState,
  note: string,
  at: number,
): void {
  const s = getState();
  s.requestEvents = [
    ...s.requestEvents,
    { id: nextId('ev'), requestId, actorId, fromState, toState, note, at },
  ];
}

export function sendRequest(draft: RequestDraft): ReferralRequest {
  const viewer = requireViewer();
  const s = getState();
  const now = Date.now();

  const referrer = s.members.find((m) => m.id === draft.referrerId);
  if (!referrer || !canSeeMember(viewer, referrer)) {
    throw new RuleViolation('No such member.', 'unknown_referrer');
  }
  if (referrer.id === viewer.id) {
    throw new RuleViolation('You cannot ask yourself for a referral.', 'self_request');
  }
  if (!draft.roleTitle.trim()) {
    throw new RuleViolation('Name the role you want referring for.', 'missing_role_title');
  }
  if (!s.companies.some((c) => c.id === draft.companyId)) {
    throw new RuleViolation('No such company.', 'unknown_company');
  }

  // Rule 3 — referrer capacity. Volume is controlled at the RECEIVING end.
  //
  // DL1: there is deliberately NO seeker-side quota here. No max open
  // requests, no per-company limit, no block on opening a new request while an
  // earlier loop is un-closed. A seeker in a bad month sending ten requests is
  // not the failure mode this product has; a referrer buried in requests is.
  // If you are about to add a check on `openRequestsFor(viewer.id, ...)` or on
  // how many requests the seeker already has at this company — don't. That is
  // the rule DL1 removed on purpose, and the tracker plus the nudge engine are
  // what keep loops closed instead.
  const intake = intakeCheck(referrer, s.requests, now);
  if (!intake.accepting) {
    throw new RuleViolation(
      intake.autoDeclineMessage ?? `${referrer.name} is not taking referral requests right now.`,
      `intake_${intake.reason ?? 'closed'}`,
    );
  }

  const request: ReferralRequest = {
    id: nextId('req'),
    seekerId: viewer.id,
    referrerId: referrer.id,
    companyId: draft.companyId,
    jobPostId: draft.jobPostId,
    roleUrl: draft.roleUrl,
    roleTitle: draft.roleTitle.trim(),
    resumeVersionId: viewer.resumeVersionId,
    pitch: draft.pitch,
    state: 'sent',
    stateOwner: 'referrer',
    declineReason: null,
    nextUpdateDue: addDays(now, RESPONSE_WINDOW_DAYS),
    nudgeCount: 0,
    lastNudgedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  s.requests = [...s.requests, request];
  appendEvent(request.id, viewer.id, null, 'sent', 'Request sent.', now);
  commit();
  return request;
}

/**
 * Rule 4 — state transitions.
 *
 * The viewer's role is resolved from the request itself, never passed in: a
 * caller that could name its own role could name the other side's. An admin
 * may READ a request (§4.1) but may not drive it — nobody accepts a referral
 * on a referrer's behalf.
 */
export function advanceRequest(
  id: string,
  to: RequestState,
  opts: { declineReason?: DeclineReason; note?: string } = {},
): ReferralRequest {
  const viewer = requireViewer();
  const s = getState();
  const request = s.requests.find((r) => r.id === id);
  if (!request || !canSeeRequest(viewer, request)) {
    throw new RuleViolation('No such request.', 'unknown_request');
  }

  const role: 'seeker' | 'referrer' | null =
    viewer.id === request.seekerId ? 'seeker' : viewer.id === request.referrerId ? 'referrer' : null;
  if (role === null) {
    throw new RuleViolation('Only the seeker or the referrer can move a request.', 'not_a_party');
  }

  const now = Date.now();
  // Throws on an illegal edge or the wrong actor. Refused, never corrected.
  const next = applyTransition(request, to, role, now, { declineReason: opts.declineReason });

  // Rule 2 — the duplicate-submission guard. One seeker, one role, one
  // submission. Several alumni OFFERING to refer the same person is fine and
  // common (that is why this is not checked in `sendRequest`); two of them
  // actually filing costs a referrer their bonus and creates an ATS conflict
  // on the company's side (§8).
  if (to === 'submitted') {
    const clash = duplicateSubmissionGuard(
      request.seekerId,
      request.companyId,
      request.roleTitle,
      s.requests.filter((r) => r.id !== request.id),
    );
    if (clash) {
      throw new RuleViolation(
        `${request.roleTitle} has already been submitted for this seeker at this company.`,
        'duplicate_submission',
      );
    }
  }

  s.requests = s.requests.map((r) => (r.id === next.id ? next : r));
  appendEvent(next.id, viewer.id, request.state, to, opts.note ?? '', now);
  commit();
  return next;
}

// ---------------------------------------------------------------------------
// Writes — member settings, admin, moderation
// ---------------------------------------------------------------------------

function replaceMember(next: Member): Member {
  const s = getState();
  s.members = s.members.map((m) => (m.id === next.id ? next : m));
  commit();
  return next;
}

/** Rule 3's control surface: a referrer sets their own intake, nobody else. */
export function setCaps(caps: Member['caps']): Member {
  const viewer = requireViewer();
  if (caps.maxOpen < 0 || caps.maxPerMonth < 0) {
    throw new RuleViolation('Caps cannot be negative.', 'invalid_caps');
  }
  return replaceMember({ ...viewer, caps: { ...caps } });
}

export function setPrivacy(privacy: PrivacySettings): Member {
  const viewer = requireViewer();
  return replaceMember({
    ...viewer,
    privacy: {
      confidentialSearch: privacy.confidentialSearch,
      blockedCompanyIds: [...new Set(privacy.blockedCompanyIds)],
      blockedMemberIds: [...new Set(privacy.blockedMemberIds)].filter((id) => id !== viewer.id),
    },
  });
}

export function decideVerification(
  caseId: string,
  decision: 'approved' | 'rejected' | 'more_info',
  notes: string,
): VerificationCase {
  const viewer = requireViewer();
  if (!viewer.isAdmin) throw new RuleViolation('Admins only.', 'not_admin');
  const s = getState();
  const existing = s.cases.find((c) => c.id === caseId);
  if (!existing) throw new RuleViolation('No such case.', 'unknown_case');
  if (existing.decision !== 'pending' && existing.decision !== 'more_info') {
    throw new RuleViolation('This case has already been decided.', 'already_decided');
  }
  // §6: every decision carries a reviewer, a timestamp and a reason. A
  // rejection with no note is not reviewable and not appealable.
  if (decision !== 'approved' && !notes.trim()) {
    throw new RuleViolation('Give a reason — the member may appeal this once.', 'missing_notes');
  }

  const now = Date.now();
  const next = decideCase(existing, decision, viewer.id, now, notes);
  s.cases = s.cases.map((c) => (c.id === next.id ? next : c));

  const member = s.members.find((m) => m.id === next.memberId);
  if (member) {
    const status =
      decision === 'approved' ? 'verified' : decision === 'rejected' ? 'rejected' : 'pending';
    s.members = s.members.map((m) =>
      m.id === member.id ? { ...m, status, tier: decision === 'approved' ? next.tier : m.tier } : m,
    );
  }
  commit();
  return next;
}

export function reportTarget(type: 'post' | 'member', id: string, reason: string): Report {
  const viewer = requireViewer();
  if (!reason.trim()) throw new RuleViolation('Say what is wrong with it.', 'missing_reason');
  const s = getState();
  const now = Date.now();
  const report: Report = {
    id: nextId('rep'),
    reporterId: viewer.id,
    targetType: type,
    targetId: id,
    reason: reason.trim(),
    at: now,
    resolvedAt: null,
  };
  s.reports = [...s.reports, report];
  if (type === 'post') {
    s.posts = s.posts.map((p) =>
      p.id === id && !p.reportedBy.includes(viewer.id)
        ? { ...p, reportedBy: [...p.reportedBy, viewer.id] }
        : p,
    );
  }
  commit();
  return report;
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * Time passing, applied to the data.
 *
 * Not viewer-scoped, and deliberately so: the clock has no viewer. Gating it
 * on whoever happens to be signed in would mean a request expires or a post
 * archives depending on who last opened the app.
 */
export function runClock(now: number): void {
  const s = getState();

  const requests: ReferralRequest[] = [];
  for (const request of s.requests) {
    const to = autoAdvanceFor(request, now);
    if (to !== null && canTransition(request.state, to)) {
      const next = applyTransition(request, to, 'system', now);
      appendEvent(request.id, null, request.state, to, `Auto-advanced to ${to}.`, now);
      requests.push(next);
      continue;
    }
    // Nudges are what make `autoAdvanceFor`'s no-response branch reachable, so
    // the clock has to send them. Exactly one person is nudged: whoever
    // `stateOwner` says owes the next update (§5.2).
    const nudge = nudgeDueFor(request, now);
    if (nudge.due && !isTerminal(request.state)) {
      requests.push({ ...request, nudgeCount: request.nudgeCount + 1, lastNudgedAt: now });
      continue;
    }
    requests.push(request);
  }
  s.requests = requests;

  s.posts = s.posts.map((post) => {
    if (post.archivedAt !== null) return post;
    return freshnessFor(post, now).shouldArchive ? { ...post, archivedAt: now } : post;
  });

  // Note what is NOT here: application prompts. `applicationPromptDue` goes
  // false once `promptedAt` is stamped, so stamping it from the clock would
  // silently drop the row off the applicant's tracker before they answered.
  // `recordOutcome` stamps it — when the member has actually replied.

  commit();
}

// ---------------------------------------------------------------------------
// The tracker (§10)
// ---------------------------------------------------------------------------

const REQUEST_CTA: Record<'sent' | 'accepted' | 'submitted' | 'recruiter_contact' | 'interviewing', { label: string; action: string }> = {
  sent: { label: 'Accept or decline', action: 'respond_to_request' },
  accepted: { label: 'Mark as submitted', action: 'mark_submitted' },
  submitted: { label: 'Any news yet?', action: 'update_request_outcome' },
  recruiter_contact: { label: 'Any news yet?', action: 'update_request_outcome' },
  interviewing: { label: 'Log the outcome', action: 'update_request_outcome' },
};

const STATE_LABEL: Record<RequestState, string> = {
  sent: 'Awaiting a reply',
  accepted: 'Accepted — not yet submitted',
  submitted: 'Submitted',
  recruiter_contact: 'Recruiter in touch',
  interviewing: 'Interviewing',
  declined: 'Declined',
  offer: 'Offer',
  rejected: 'Not selected',
  no_response: 'No response',
  expired: 'Expired — no reply',
  expired_unsubmitted: 'Expired — never submitted',
  role_closed: 'Role closed',
};

/**
 * Whose turn it is, for one member, across everything they owe or are owed.
 *
 * Under DL1 this is load-bearing. D5's hard block on new requests is gone, so
 * this surface plus the nudge engine is the ONLY thing left keeping loops
 * closed — §11's >70% closure target is the number that says whether that was
 * enough. Hence: what you owe sorts to the top, and every row you owe carries
 * exactly one thing to do.
 *
 * `memberId` must be the viewer's own id. The tracker is a first-person view
 * and there is no admin exception (rule 1) — an admin asking for someone
 * else's tracker gets an empty list, not a back door.
 */
export function trackerFor(memberId: string, now: number): TrackerRow[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  if (viewer.id !== memberId) return [];
  const s = getState();
  const nameOf = (id: string): string | null => {
    const m = s.members.find((x) => x.id === id);
    return m && canSeeMember(viewer, m) ? m.name : null;
  };
  const rows: TrackerRow[] = [];

  // 1. Requests the member is party to. `visibleRequests` first, so the
  //    privacy filter is what decides, not the party check.
  for (const r of visibleRequests(viewer, s.requests)) {
    const mineAs: 'seeker' | 'referrer' | null =
      r.seekerId === memberId ? 'seeker' : r.referrerId === memberId ? 'referrer' : null;
    if (mineAs === null) continue;

    const owner = r.stateOwner ?? OWNER_BY_STATE[r.state];
    const owed: TrackerRow['owed'] = owner === null ? 'nobody' : owner === mineAs ? 'you' : 'them';
    const cta =
      owed === 'you'
        ? (REQUEST_CTA[r.state as keyof typeof REQUEST_CTA] ?? { label: 'Add an update', action: 'update_request_outcome' })
        : null;

    rows.push({
      id: r.id,
      kind: 'request',
      title: r.roleTitle,
      subtitle: `${s.companies.find((c) => c.id === r.companyId)?.name ?? 'Undisclosed'} · ${STATE_LABEL[r.state]}`,
      counterpartyName: nameOf(mineAs === 'seeker' ? r.referrerId : r.seekerId),
      state: r.state,
      owed,
      dueAt: r.nextUpdateDue,
      overdueDays: r.nextUpdateDue === null ? 0 : daysBetween(r.nextUpdateDue, now),
      cta,
    });
  }

  // 2. Their own applications with a prompt due. §5.1: one prompt, never
  //    blocking — a job board cannot fairly be gated on answering it.
  for (const a of s.applications) {
    if (a.memberId !== memberId) continue;
    if (!applicationPromptDue(a, now)) continue;
    const post = s.posts.find((p) => p.id === a.jobPostId);
    const dueAt = addDays(a.appliedAt, APPLICATION_PROMPT_DAY);
    rows.push({
      id: a.id,
      kind: 'application',
      title: post?.title ?? 'A role you applied to',
      subtitle: post ? `${companyLabel(post, s)} · Applied ${daysBetween(a.appliedAt, now)} days ago` : 'Applied',
      counterpartyName: post ? nameOf(post.posterId) : null,
      state: a.outcome,
      owed: 'you',
      dueAt,
      overdueDays: daysBetween(dueAt, now),
      cta: { label: 'Did you hear back?', action: 'record_application_outcome' },
    });
  }

  // 3. Their own posts needing confirmation (D14: confirm-or-decay).
  for (const p of s.posts) {
    if (p.posterId !== memberId) continue;
    if (p.archivedAt !== null) continue;
    const freshness = freshnessFor(p, now);
    if (!freshness.promptDue) continue;
    const dueAt = addDays(p.lastConfirmedAt, CONFIRM_PROMPT_DAYS[0]);
    rows.push({
      id: p.id,
      kind: 'post',
      title: p.title,
      subtitle: `${companyLabel(p, s)} · ${freshness.label}`,
      counterpartyName: null,
      state: freshness.state,
      owed: 'you',
      dueAt,
      overdueDays: daysBetween(dueAt, now),
      cta: { label: 'Still open?', action: 'confirm_post' },
    });
  }

  return rows.sort(
    (a, b) => (a.owed === 'you' ? 0 : 1) - (b.owed === 'you' ? 0 : 1) || b.overdueDays - a.overdueDays,
  );
}
