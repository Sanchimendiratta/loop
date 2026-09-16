/**
 * The repository boundary.
 *
 * The only module that touches persistence, and the only place two rules now
 * live (spec §4.1): the privacy filter and the duplicate-POST merge rule.
 * Lite dropped the referral-request object, and with it the duplicate-
 * submission guard, referrer capacity and the state-transition machine that
 * used to live here too — see `viewerOrNull` and `canSeeMember` below for what
 * of the privacy filter survived that prune. Rules are enforced here rather
 * than in the screens because a rule enforced in a dialog is a suggestion —
 * any other code path walks straight past it.
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
  DestinationType,
  JobPost,
  Member,
  MemberStatus,
  PostApplication,
  PostShare,
  PosterRelationship,
  Report,
  VerificationCase,
} from './schema.ts';
/**
 * `RuleViolation`, relocated. It used to live in `core/requests.ts` (deleted
 * with the referral-request state machine) but was never really about
 * requests — every write in this file throws it, from a missing post title to
 * an admin-only guard. UI modules still import it from here, which is why it
 * is exported.
 */
export class RuleViolation extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'RuleViolation';
    this.code = code;
  }
}
import { freshnessFor } from '../core/freshness.ts';
import { sortPosts } from '../core/rank.ts';
import { decideCase } from '../core/verification.ts';

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

export interface PostStats {
  views: number;
  applied: number;
  heardBack: number;
  interviewing: number;
  outcomesUnknown: boolean;
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

/**
 * The whole workspace, unscoped. TEST-ONLY.
 *
 * This is the one function in this file that answers without asking who is
 * looking. It exists so the test suite can place a fixture and then check what
 * a scoped read did or did not return — which is impossible if the only way in
 * is already filtered.
 *
 * NO module under `src/ui/` may call it. It bypasses every viewer scope in
 * this file at once: `getState().members` hands a component the blocked-company
 * list that `toPublicMember` exists to strip, and `getState().requests` hands
 * it every private 1:1 request in the network. A screen that needs different
 * data needs a new store function, not this. Task 25 greps `src/ui/` for it.
 */
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

export interface Persona {
  id: string;
  name: string;
  status: MemberStatus;
}

/**
 * The full roster of demo identities, for the persona switcher that stands in
 * for Google's account chooser (Task 16).
 *
 * Deliberately NOT viewer-scoped — picking which account to sign in as is a
 * pre-authentication choice, not a network read, and gating it on
 * verified-only status would strand a session on an unverified persona with
 * no way back to a verified one. It is safe precisely because it is this
 * narrow: no company, no privacy settings, no contact fields.
 */
export function listPersonas(): Persona[] {
  return getState().members.map((m) => ({ id: m.id, name: m.name, status: m.status }));
}

/**
 * D2, relocated. `core/privacy.ts` existed mostly to protect a seeker from
 * discovery in a directory, and Lite has no directory — but "an unverified
 * account can see nothing" is the product itself, not a directory feature, so
 * it lives here now. Every read begins with this.
 */
function viewerOrNull(): Member | null {
  const s = getState();
  const me = s.members.find((m) => m.id === s.currentMemberId);
  return me && me.status === 'verified' ? me : null;
}

/**
 * D6, relocated from `core/privacy.ts` alongside `viewerOrNull`. A seeker's
 * block is enforced on the TARGET, not the viewer — Karan blocks his own
 * employer, and it is his row that must refuse to render, wherever it is
 * asked for. No admin exception: `postsVisibleTo` and `applicationsFor` are
 * the only two callers left, and neither grants one.
 */
function canSeeMember(viewer: Member, target: Member): boolean {
  if (viewer.id === target.id) return true;
  if (target.privacy.blockedMemberIds.includes(viewer.id)) return false;
  if (viewer.companyId && target.privacy.blockedCompanyIds.includes(viewer.companyId)) return false;
  return true;
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

/**
 * A post whose poster is invisible to the viewer is invisible too: a blocked
 * member must not be discoverable via their own posts (§6/D6).
 *
 * This is the single source of truth for post visibility. Every read of
 * `s.posts` — stats, write guards, the board — must come from here rather
 * than re-deriving the rule against `s.posts` directly. A second predicate
 * drifts the moment one of these conditions changes; it already did, four
 * times, before this comment existed.
 */
function postsVisibleTo(viewer: Member, s: AppState): JobPost[] {
  const byId = new Map(s.members.map((m) => [m.id, m]));
  return s.posts.filter((p) => {
    // §8: a report still awaiting a decision hides the post from the board —
    // for everyone except an admin, who is the one person who has to be able
    // to open it in order to decide the report at all. This is a moderation
    // gate, not a privacy one: it does not touch `canSeeMember` and grants no
    // bypass of a blocking member's row (checked below regardless).
    if (postHasOpenReport(p.id, s) && !viewer.isAdmin) return false;
    const poster = byId.get(p.posterId);
    if (!poster) return false;
    // A suspended poster's posts come down too, for everyone but an admin —
    // otherwise upholding a report against a spammer leaves every other post
    // they made on the board, removable only one report at a time.
    if (poster.status === 'suspended' && !viewer.isAdmin) return false;
    return canSeeMember(viewer, poster);
  });
}

function postHasOpenReport(postId: string, s: AppState): boolean {
  return s.reports.some((r) => r.targetType === 'post' && r.targetId === postId && r.resolvedAt === null);
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

export function listCompanies(): Company[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  return [...getState().companies];
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
  // Routed through `postsVisibleTo` rather than `s.posts.find` directly: a
  // post hidden by an open report must not surface its counts either, or a
  // poster's own stats panel would keep counting a post nobody else can open.
  const post = postsVisibleTo(viewer, s).find((p) => p.id === postId);
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

// ---------------------------------------------------------------------------
// Writes — posts
// ---------------------------------------------------------------------------

const CONSENT_REQUIRED_DESTINATIONS: DestinationType[] = ['named_person', 'external_recruiter'];

/**
 * Duplicate-post detection (§5.1), relocated from `core/dedupe.ts`. Lite drops
 * the WhatsApp digest and the sharer-name summary that module also carried,
 * but the merge rule itself is still load-bearing: `publishPost` below still
 * merges four alumni forwarding the same JD into one card instead of four.
 * The key is the apply route plus the role title — the route is what actually
 * identifies a role across differently-worded forwards.
 */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source', 'src',
];

const TITLE_SYNONYMS: [RegExp, string][] = [
  [/\bsr\.?\b/gi, 'senior'],
  [/\bjr\.?\b/gi, 'junior'],
  [/\bmgr\.?\b/gi, 'manager'],
  [/\bassoc\.?\b/gi, 'associate'],
  [/\bvp\b/gi, 'vice president'],
];

function normaliseRoute(v: string): string {
  const raw = String(v ?? '').trim();
  if (!raw) return '';

  if (raw.includes('@') && !raw.startsWith('http')) return raw.toLowerCase();

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const host = u.host.toLowerCase().replace(/^www\./, '');
      const path = u.pathname.replace(/\/+$/, '');
      for (const t of TRACKING_PARAMS) u.searchParams.delete(t);
      u.searchParams.sort();
      const query = u.searchParams.toString();
      return `${host}${path}${query ? `?${query}` : ''}`;
    } catch {
      return raw.toLowerCase();
    }
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 10) {
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
    return digits;
  }
  return raw.toLowerCase();
}

function normaliseTitle(t: string): string {
  let out = String(t ?? '').toLowerCase();
  for (const [re, to] of TITLE_SYNONYMS) out = out.replace(re, to);
  return out.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A stable, readable key. Not cryptographic — collisions here are cheap. */
function dedupeHash(applyValue: string, title: string): string {
  return `${normaliseRoute(applyValue)}::${normaliseTitle(title)}`;
}

// The real archive rule (`freshnessFor(...).shouldArchive`, the same one
// `runClock` uses), not a second guess at it. `reset()` deliberately never
// runs the clock, so a day-45+ post can sit un-archived in the seed; a merge
// target check that only asked `confirmState !== 'filled'` would happily
// merge a new forward into a post that is one clock tick from disappearing.
function livePostByHash(hash: string, s: AppState, now: number): JobPost | null {
  return (
    s.posts.find((p) => p.dedupeHash === hash && p.archivedAt === null && !freshnessFor(p, now).shouldArchive) ?? null
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
  const existing = livePostByHash(hash, s, now);

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

// Routed through `postsVisibleTo` — the same gate the read path uses — rather
// than a second, looser predicate. There is deliberately no `?? viewer`
// fallback: a post whose poster cannot be resolved, or is not visible to this
// viewer for any reason `postsVisibleTo` recognises (a report pending review,
// a blocking member, a suspended poster), fails closed here exactly as it
// does on read. The read path failing closed while the write path failed
// open was the bug: `confirmPost`, `applyToPost` and `flagUnreachable` all
// still succeeded against a post that had already vanished from the board.
function requirePostForWrite(postId: string, viewer: Member): JobPost {
  const post = postsVisibleTo(viewer, getState()).find((p) => p.id === postId);
  if (!post) throw new RuleViolation('No such post.', 'unknown_post');
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
 * §5.1: the poster's own view count — one of the three numbers on the
 * poster dashboard, previously initialised to 0 and never incremented.
 * Viewer-scoped like a read (silently does nothing rather than throwing)
 * because a page view is not a rule a caller needs to react to failing: no
 * viewer, or a post not visible to them, is simply not a view. A no-op when
 * the viewer is the post's own poster — checking your own post is not a
 * view of it. No per-viewer dedup: a raw counter, not analytics.
 */
export function recordPostView(postId: string): void {
  const viewer = viewerOrNull();
  if (!viewer) return;
  const post = postsVisibleTo(viewer, getState()).find((p) => p.id === postId);
  if (!post || post.posterId === viewer.id) return;
  replacePost({ ...post, viewCount: post.viewCount + 1 });
}

/**
 * D13: a named contact who never asked to be on a job board can have their
 * details taken down. Honoured immediately rather than queued, because the
 * harm is the details being served, and a queue keeps serving them. A
 * `named_person` card is archived too: its only apply route WAS that person.
 *
 * Deliberately not restricted to the poster or an admin: by D15 the LISTED
 * CONTACT is not a member at all, so a poster-only guard would make D13's
 * "honoured within 48h" promise unreachable for the one person it is made
 * to. In a real deployment this is the unauthenticated route a non-member
 * contact reaches directly; the nearest honest thing here, with no such
 * route, is that any verified member may request removal on a contact's
 * behalf — a takedown request is not a privilege to gate.
 */
export function requestContactRemoval(postId: string): JobPost {
  const viewer = requireViewer();
  const post = requirePostForWrite(postId, viewer);
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
// Writes — member settings, admin, moderation
// ---------------------------------------------------------------------------

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
  // §8 is a member-facing safety valve against SOMEONE ELSE's post or
  // profile — not a way to flag your own. Enforced here, not just by hiding
  // the button, for the same reason every other rule lives in this file.
  if (type === 'member' && id === viewer.id) {
    throw new RuleViolation('You cannot report yourself.', 'self_report');
  }
  if (type === 'post' && s.posts.find((p) => p.id === id)?.posterId === viewer.id) {
    throw new RuleViolation('You cannot report your own post.', 'self_report');
  }
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

/**
 * The admin moderation queue (§8). Only what is still awaiting a decision —
 * once resolved, a report drops out of here (Admin.tsx keeps no separate
 * "resolved reports" list; the post's own state, or the member's, is the
 * lasting record).
 */
export function listReports(): Report[] {
  const viewer = viewerOrNull();
  if (!viewer || !viewer.isAdmin) return [];
  return getState()
    .reports.filter((r) => r.resolvedAt === null)
    .sort((a, b) => a.at - b.at);
}

function requireOpenReport(reportId: string): { viewer: Member; s: AppState; report: Report } {
  const viewer = requireViewer();
  if (!viewer.isAdmin) throw new RuleViolation('Admins only.', 'not_admin');
  const s = getState();
  const report = s.reports.find((r) => r.id === reportId);
  if (!report) throw new RuleViolation('No such report.', 'unknown_report');
  if (report.resolvedAt !== null) throw new RuleViolation('This report has already been resolved.', 'already_resolved');
  return { viewer, s, report };
}

/** §8: a report upheld archives the post, or suspends the member. */
export function upholdReport(reportId: string): Report {
  const { s, report } = requireOpenReport(reportId);
  const now = Date.now();

  if (report.targetType === 'post') {
    s.posts = s.posts.map((p) => (p.id === report.targetId && p.archivedAt === null ? { ...p, archivedAt: now } : p));
  } else {
    s.members = s.members.map((m) => (m.id === report.targetId ? { ...m, status: 'suspended' } : m));
  }

  const next: Report = { ...report, resolvedAt: now };
  s.reports = s.reports.map((r) => (r.id === next.id ? next : r));
  commit();
  return next;
}

/** §8: dismissing a report clears it with no further action — a post it was
 * hiding pending review reappears, because `postHasOpenReport` now reads false. */
export function dismissReport(reportId: string): Report {
  const { s, report } = requireOpenReport(reportId);
  const now = Date.now();
  const next: Report = { ...report, resolvedAt: now };
  s.reports = s.reports.map((r) => (r.id === next.id ? next : r));
  commit();
  return next;
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * Time passing, applied to the data.
 *
 * Not viewer-scoped, and deliberately so: the clock has no viewer. Gating it
 * on whoever happens to be signed in would mean a post archives depending on
 * who last opened the app. Lite dropped the referral-request state machine
 * this used to also advance (auto-expiry, nudges) along with the nudge
 * engine that drove it — post archiving is the whole clock now.
 */
export function runClock(now: number): void {
  const s = getState();
  let changed = false;

  let postsChanged = false;
  const posts = s.posts.map((post) => {
    if (post.archivedAt !== null) return post;
    if (!freshnessFor(post, now).shouldArchive) return post;
    postsChanged = true;
    return { ...post, archivedAt: now };
  });
  if (postsChanged) {
    s.posts = posts;
    changed = true;
  }

  // A tick that changed nothing must not commit. The UI runs this every 60
  // seconds, and committing regardless would hand React fresh array identities
  // sixty times a minute and re-render the whole app for no reason.
  if (changed) commit();
}
