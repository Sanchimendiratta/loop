/**
 * The repository boundary.
 *
 * Much smaller than v1.3's, because Lite has far less to protect: no directory,
 * no member search, no referral-request object. Three rules remain, and all
 * three live here rather than in a screen:
 *
 *   1. D2 — an unverified or pending member reads nothing. Not posts, not
 *      applications, not counts. `core/privacy.ts` is gone, so this is where
 *      the rule lives now.
 *   2. Applicant details reach exactly one person: the poster of the post they
 *      applied to. Not other applicants, not admins. Applying is a targeted
 *      disclosure to one member, which is why Lite can drop the directory and
 *      end up with a STRONGER privacy position than v1.3 — "you applied to my
 *      post" is now the only path by which one member sees another's details.
 *   3. You edit only your own rows: your application's status, your post's
 *      status. And you cannot report yourself.
 *
 * `getState()` is test-only; no `src/ui/` module may call it. The smoke script
 * fails the build if one does.
 *
 * Lite has no duplicate-post merge and therefore no `dedupeHash`: §1 drops it
 * ("not needed below a few hundred posts") and §7's `job_post` has no such
 * column. Two posts of the same role appear twice; that is accepted behaviour,
 * not an oversight.
 *
 * Swapping this for Supabase means reimplementing this file against Postgres
 * with RLS, and changing nothing above it. That is the entire reason the read
 * functions resolve the viewer themselves instead of the screens filtering
 * afterwards.
 */
import { buildSeed } from './seed.ts';
import type { AppState, GoogleIdentity } from './seed.ts';
export type { GoogleIdentity } from './seed.ts';
import { SCHEMA_VERSION } from './schema.ts';
import type {
  Application,
  ApplicationStatus,
  ApplyMethod,
  Connection,
  FunctionArea,
  JobPost,
  Member,
  MemberStatus,
  Notification,
  PostStatus,
  Programme,
  Report,
} from './schema.ts';
import { notificationBody } from '../core/notifications.ts';
import { sortPosts } from '../core/rank.ts';
import { LOOP_SCHOOL, tierForEmail } from '../core/verification.ts';

/**
 * `RuleViolation`, relocated. It used to live in `core/requests.ts` (deleted
 * with the referral-request state machine) but was never really about
 * requests — every write in this file throws it, from a missing connection
 * field to an admin-only guard. UI modules import it from here.
 */
export class RuleViolation extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'RuleViolation';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'loop.lite.v1';

/**
 * `undefined` under Vitest and under the SSR smoke run, where there is no DOM.
 * Guarded in one place so no call site has to remember.
 */
function storage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

let state: AppState | null = null;
const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Persist, then notify. Every write ends here and nowhere else. */
function commit(): void {
  const store = storage();
  if (store && state) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A full or disabled storage must not take the app down with it.
    }
  }
  for (const fn of listeners) fn();
}

export interface LoadOptions {
  now?: number;
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
  commit();
  return state;
}

/**
 * A fresh workspace holding the demo exactly as authored.
 *
 * There is no clock to run: Lite dropped the confirm-or-decay engine, so
 * ageing is computed at read time by `core/freshness.ts` and nothing about a
 * row changes just because time passed.
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
 * NO module under `src/ui/` may call it. It bypasses all three rules at once:
 * `getState().applications` hands a component every applicant on every post,
 * which rule 2 exists to keep to one person, and it answers for a pending
 * viewer that rule 1 says may read nothing. A screen that needs different data
 * needs a new store function, not this. `scripts/smoke.mjs` greps for it.
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

/**
 * The viewer's own record, in full — email, googleSub, LinkedIn URL, and the
 * reviewer's decision note.
 *
 * The third and last read in this file that does NOT begin with
 * `viewerOrNull()`, and deliberately so: it answers only ever about the person
 * asking, so there is no one for it to leak to. Gating it on `verified` would
 * also break the two screens that exist precisely for the members it would
 * refuse — `VerificationGate` reads `status` to decide which gate to show, and
 * the persona switcher sits above that gate so a pending member is not
 * stranded with no way back to a verified account.
 *
 * The exemption is bounded by "own record only". It must never grow a
 * `memberId` parameter: the moment it can answer about someone else it becomes
 * the directory read Lite deleted, and rule 2 — applicant details reach
 * exactly one person — would have a second, ungated way around it.
 *
 * Returns `null` while `newSignIn` is set, even though `currentMemberId`
 * still points at whoever was signed in before — see `beginNewSignIn` below.
 * A fresh Google identity with no row yet has no member to be.
 */
export function getCurrentMember(): Member | null {
  const s = getState();
  if (s.newSignIn) return null;
  return s.members.find((m) => m.id === s.currentMemberId) ?? null;
}

/**
 * Also ends any in-progress `newSignIn`: choosing an account — an existing
 * one from the switcher, or the one `submitVerification` just created — is
 * always how that state resolves, never something a caller clears
 * separately. Leaving it set after this would make `getCurrentMember()` keep
 * answering `null` for the id that was just chosen.
 */
export function setCurrentMember(id: string): void {
  const s = getState();
  const member = s.members.find((m) => m.id === id);
  if (!member) throw new RuleViolation('No such member.', 'unknown_member');
  if (s.currentMemberId === id && !s.newSignIn) return;
  s.currentMemberId = id;
  s.newSignIn = null;
  commit();
}

export interface Persona {
  id: string;
  name: string;
  status: MemberStatus;
}

/**
 * The full roster of demo identities, for the persona switcher that stands in
 * for Google's account chooser.
 *
 * Deliberately NOT viewer-scoped — picking which account to sign in as is a
 * pre-authentication choice, not a network read, and gating it on
 * verified-only status would strand a session on an unverified persona with
 * no way back to a verified one. It is safe precisely because it is this
 * narrow: a name and a gate state, no email, no LinkedIn, no applications.
 */
export function listPersonas(): Persona[] {
  return getState().members.map((m) => ({ id: m.id, name: m.name, status: m.status }));
}

/**
 * The other half of the auth stand-in `listPersonas` is documented as: there
 * is no real Google OAuth here, so "the visitor picked an account Google
 * returned that has no matching row" has to be simulated somehow. This is
 * that simulation, and it is deliberately a store write rather than component
 * state, for the same reason `currentMemberId` itself lives here — every
 * screen that cares (`VerificationGate`, and the switcher in `App`) has to
 * agree on the answer, through the one subscribe/commit path everything else
 * in this file already goes through, not a second channel next to it.
 *
 * Takes priority over `currentMemberId`: a person can start a second Google
 * sign-in without first signing out of a session that is already verified,
 * pending or rejected — `getCurrentMember()` above answers `null` the moment
 * this is set, and stays that way until `setCurrentMember` resolves it.
 */
export function beginNewSignIn(identity: GoogleIdentity): void {
  const s = getState();
  s.newSignIn = identity;
  commit();
}

/**
 * Signing out — the only way to reach `Login` (screen 1) in a running build.
 *
 * Without this, `currentMemberId` always names a seeded row and the gate's
 * `!member` branch is unreachable, so screen 1 is implemented, rendered by the
 * smoke script, and yet impossible to get to by any navigation. That failed
 * the spec's "all eight screens are reachable" criterion.
 *
 * Clears `newSignIn` too: signing out of an account while a second sign-in is
 * half-finished should leave one empty session, not a half-finished one.
 */
export function signOut(): void {
  const s = getState();
  s.currentMemberId = null;
  s.newSignIn = null;
  commit();
}

/** Abandoning the form without submitting it. Simply un-sets the flag; `currentMemberId` was never touched, so whoever was signed in before is signed in again. */
export function cancelNewSignIn(): void {
  const s = getState();
  if (!s.newSignIn) return;
  s.newSignIn = null;
  commit();
}

/** The identity `beginNewSignIn` recorded, or `null` if none is in progress. Ungated for the same reason `listPersonas` is: there is no member yet to gate it on. */
export function pendingNewSignIn(): GoogleIdentity | null {
  return getState().newSignIn;
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

/** The same guard for writes, where the honest answer is a refusal. */
function requireViewer(): Member {
  const viewer = viewerOrNull();
  if (!viewer) {
    throw new RuleViolation('Your membership is not verified yet.', 'not_verified');
  }
  return viewer;
}

function requireAdmin(): Member {
  const viewer = requireViewer();
  if (!viewer.isAdmin) {
    throw new RuleViolation('Only an admin can do that.', 'not_admin');
  }
  return viewer;
}

// ---------------------------------------------------------------------------
// Reads — every one begins with the viewer, no exception, including for admins
// ---------------------------------------------------------------------------

/**
 * The board. Nothing is filtered off it: a filled or long-stale post still
 * appears, greyed and sunk, because a poster who never came back should see
 * their post fade rather than vanish (§6 sheet 3).
 */
export function listPosts(now: number, mode: 'connection' | 'recent' = 'connection'): JobPost[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  return sortPosts(getState().posts, now, mode);
}

export function getPost(id: string): JobPost | null {
  const viewer = viewerOrNull();
  if (!viewer) return null;
  return getState().posts.find((p) => p.id === id) ?? null;
}

/**
 * The poster's display name, by member id — everything else about another
 * member stays behind rule 2. Callers hold a post, so `posterName(post.posterId)`
 * is the shape this is written for — not a general member-name lookup. Its
 * only production callers are `Board.tsx` and `MyApplications.tsx`, both
 * always called with a `post.posterId`. `decidedCases()` below used to be
 * called this way too (`posterName(member.decidedById)` in `Admin.tsx`, to
 * show which admin decided a case), which is not a post's poster — that is
 * fixed by having `decidedCases()` carry `decidedByName` itself instead.
 */
export function posterName(id: string): string {
  const viewer = viewerOrNull();
  if (!viewer) return '';
  return getState().members.find((m) => m.id === id)?.name ?? 'A member';
}

/** The sheet: your own rows, newest application first. */
export function myApplications(_now: number): Application[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  return getState()
    .applications.filter((a) => a.memberId === viewer.id)
    .sort((a, b) => b.appliedAt - a.appliedAt);
}

export function myPosts(): JobPost[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  return getState()
    .posts.filter((p) => p.posterId === viewer.id)
    .sort((a, b) => b.postedAt - a.postedAt);
}

export interface Applicant {
  memberId: string;
  name: string;
  batch: number;
  programme: Programme;
  linkedinUrl: string;
  status: ApplicationStatus;
  appliedAt: number;
}

/**
 * Rule 2, in one function.
 *
 * Returns applicants only to the poster of that post. There is deliberately no
 * admin branch: an admin moderating a post has no business reading who applied
 * to it, and "the rule has one exception" is how a rule stops being one.
 */
export function applicantsFor(postId: string): Applicant[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  const s = getState();
  const post = s.posts.find((p) => p.id === postId);
  if (!post || post.posterId !== viewer.id) return [];

  const out: Applicant[] = [];
  for (const a of s.applications) {
    if (a.jobPostId !== postId) continue;
    const m = s.members.find((x) => x.id === a.memberId);
    if (!m) continue;
    out.push({
      memberId: m.id,
      name: m.name,
      batch: m.batch,
      programme: m.programme,
      linkedinUrl: m.linkedinUrl,
      status: a.status,
      appliedAt: a.appliedAt,
    });
  }
  return out.sort((a, b) => b.appliedAt - a.appliedAt);
}

/** Your own application to a post, if you have one. Drives the Apply button. */
export function applicationFor(postId: string): Application | null {
  const viewer = viewerOrNull();
  if (!viewer) return null;
  return getState().applications.find((a) => a.jobPostId === postId && a.memberId === viewer.id) ?? null;
}

export function myNotifications(): Notification[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  return getState()
    .notifications.filter((n) => n.memberId === viewer.id)
    .sort((a, b) => b.at - a.at);
}

export interface PendingCase {
  id: string;
  name: string;
  batch: number;
  programme: Programme;
  knownBy: string | null;
  linkedinUrl: string;
  requestedAt: number;
}

/**
 * The admin queue. Admin-only, and still gated on the viewer being verified.
 *
 * Returns `PendingCase`, not `Member` — the same narrowing `decidedCases`
 * below gets. `Admin.tsx`'s `QueueRow` renders a name, batch, programme,
 * `knownBy`, LinkedIn URL and requested-on, two buttons, and nothing else; it
 * has no business handing that screen `email` or `googleSub` along with the
 * rest of the row. Row scoping (admin-only) is not field scoping.
 */
export function pendingCases(): PendingCase[] {
  const viewer = viewerOrNull();
  if (!viewer || !viewer.isAdmin) return [];
  return getState()
    .members.filter((m) => m.status === 'pending')
    .sort((a, b) => a.requestedAt - b.requestedAt)
    .map((m) => ({
      id: m.id,
      name: m.name,
      batch: m.batch,
      programme: m.programme,
      knownBy: m.knownBy,
      linkedinUrl: m.linkedinUrl,
      requestedAt: m.requestedAt,
    }));
}

export function listReports(): Report[] {
  const viewer = viewerOrNull();
  if (!viewer || !viewer.isAdmin) return [];
  return getState()
    .reports.filter((r) => r.resolvedAt === null)
    .sort((a, b) => b.at - a.at);
}

export interface DecidedCase {
  id: string;
  name: string;
  status: MemberStatus;
  decidedById: string | null;
  /** The reviewer's display name, resolved here rather than by the caller — see below. */
  decidedByName: string;
  decidedAt: number | null;
  decisionNote: string;
}

/**
 * The audit trail beneath the queue: every case a human reviewer has actually
 * ruled on, newest first. `decidedById` is the filter rather than `status`
 * alone — an institute address in `submitVerification` also leaves `pending`
 * with `status: 'verified'`, but nobody decided it, so it does not belong on
 * a "who decided, when, why" list. Admin-only, same gate as `pendingCases`.
 *
 * Returns `DecidedCase`, not `Member` — the same narrowing `applicantsFor`
 * does for `Applicant`. `Admin.tsx`'s audit trail renders a name, the
 * decision, who decided it, when, and the note; it has no business handing
 * that screen `email` or `googleSub` along with the rest of the row. Row
 * scoping (admin-only) is not field scoping.
 *
 * `decidedByName` is resolved here, not by the caller: `posterName`'s
 * contract is "the caller holds a post" (`posterName(post.posterId)`), and
 * "which admin decided this case" is not that — it is an unscoped lookup by
 * member id, over a table `Admin.tsx` (a screen, not the store) has no
 * business reading directly. Doing the lookup here, once, against the same
 * `s.members` this function already has open, keeps that lookup inside the
 * repository boundary instead of pushing it back out through a function
 * whose docblock says it is for something else.
 */
export function decidedCases(): DecidedCase[] {
  const viewer = viewerOrNull();
  if (!viewer || !viewer.isAdmin) return [];
  const s = getState();
  return s.members
    .filter((m) => m.decidedById !== null)
    .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
    .map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      decidedById: m.decidedById,
      decidedByName: s.members.find((x) => x.id === m.decidedById)?.name ?? 'A member',
      decidedAt: m.decidedAt,
      decisionNote: m.decisionNote,
    }));
}

/**
 * Exactly what applying discloses, named by the store rather than by a screen.
 *
 * The consent line on the Apply dialog has to say what actually happens. If the
 * UI wrote its own list it would drift the first time `applicantsFor` changed
 * shape, and the drift would be silent — a promise the store no longer keeps.
 */
export function applyDisclosureFields(): string[] {
  const viewer = viewerOrNull();
  if (!viewer) return [];
  return [
    'your name',
    'your batch and programme',
    'your LinkedIn URL',
    'the status you set',
    'when you applied',
  ];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function notify(
  s: AppState,
  memberId: string,
  kind: Notification['kind'],
  ctx: { actorName?: string; roleTitle?: string },
  link: string,
  at: number,
): void {
  s.notifications = [
    ...s.notifications,
    {
      id: nextId('n'),
      memberId,
      kind,
      body: notificationBody(kind, ctx),
      link,
      readAt: null,
      pushedAt: null,
      emailedAt: null,
      at,
    },
  ];
}

export interface VerificationInput {
  googleSub: string;
  email: string;
  name: string;
  batch: number;
  programme: Programme;
  linkedinUrl: string;
  knownBy: string | null;
}

/**
 * The front door (§3). An institute address is a domain fact and verifies
 * itself; everything else waits for a human, which is the whole of D2.
 *
 * Deliberately NOT viewer-gated: this is the one write a non-member makes.
 *
 * Two refusals, for the only two free-text fields a reviewer actually reads:
 * a blank `name` renders an empty admin queue row, and a blank `linkedinUrl`
 * renders `<a href="">`. `batch` and `programme` come off closed `<select>`s
 * and can't be blank the same way, so they get no refusal here. Both trim
 * before checking — whitespace is not presence. `linkedinUrl` stays a plain
 * string otherwise: no format check, no fetch, per §7.4.
 */
export function submitVerification(input: VerificationInput, now: number = Date.now()): Member {
  if (!input.name?.trim()) {
    throw new RuleViolation('Your name is required.', 'missing_name');
  }
  if (!input.linkedinUrl?.trim()) {
    throw new RuleViolation('A LinkedIn URL is required.', 'missing_linkedin');
  }

  const s = getState();
  const tier = tierForEmail(input.email, LOOP_SCHOOL);
  const verified = tier === 'A';

  const member: Member = {
    id: nextId('m'),
    googleSub: input.googleSub,
    email: input.email,
    name: input.name,
    batch: input.batch,
    programme: input.programme,
    linkedinUrl: input.linkedinUrl,
    knownBy: input.knownBy,
    verifiedBy: verified ? 'domain' : null,
    status: verified ? 'verified' : 'pending',
    isAdmin: false,
    requestedAt: now,
    decidedAt: verified ? now : null,
    decidedById: null,
    decisionNote: verified ? 'Institute address — verified instantly, no reviewer needed.' : '',
  };

  s.members = [...s.members, member];
  if (verified) notify(s, member.id, 'you_were_verified', {}, '/board', now);
  commit();
  return member;
}

/**
 * An admin's decision, with the reviewer, the time and the reason recorded.
 * §3 is candid that this is a plausibility check over a self-declared LinkedIn
 * entry, not proof — which is exactly why it has to carry a name and a note.
 */
export function decideVerification(
  memberId: string,
  decision: 'verified' | 'rejected',
  note: string,
  now: number = Date.now(),
): Member {
  const admin = requireAdmin();
  const s = getState();
  const target = s.members.find((m) => m.id === memberId);
  if (!target) throw new RuleViolation('No such member.', 'unknown_member');
  if (target.status !== 'pending') {
    throw new RuleViolation('That case has already been decided.', 'already_decided');
  }

  const updated: Member = {
    ...target,
    status: decision,
    verifiedBy: decision === 'verified' ? 'admin' : null,
    decidedAt: now,
    decidedById: admin.id,
    decisionNote: note,
  };

  s.members = s.members.map((m) => (m.id === memberId ? updated : m));
  if (decision === 'verified') notify(s, memberId, 'you_were_verified', {}, '/board', now);
  commit();
  return updated;
}

export interface PostDraft {
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
  contactName: string | null;
  rawPaste: string | null;
}

/**
 * Publishing (L3): any verified member may post. No pre-approval queue — one
 * existed in v1.3 and it is the surest way to make a volunteer stop posting.
 *
 * Two refusals only, and both are about honesty rather than quality: a post
 * with no `connection` is the field the whole board ranks on, and a
 * confidential post with no descriptor tells a reader nothing at all about
 * where they would be applying.
 */
export function publishPost(draft: PostDraft, now: number = Date.now()): JobPost {
  const viewer = requireViewer();

  if (!draft.title?.trim()) {
    throw new RuleViolation('A post needs a role title.', 'missing_title');
  }
  if (!draft.connection) {
    throw new RuleViolation('Say how you are connected to this role.', 'missing_connection');
  }
  if (!draft.applyValue?.trim()) {
    throw new RuleViolation('A post needs a way to apply.', 'missing_route');
  }
  if (draft.isConfidential && !draft.confidentialDescriptor?.trim()) {
    throw new RuleViolation(
      'Describe the company without naming it, so a reader knows what they are applying to.',
      'missing_descriptor',
    );
  }

  const s = getState();
  const post: JobPost = {
    id: nextId('p'),
    posterId: viewer.id,
    title: draft.title.trim(),
    companyName: draft.isConfidential ? null : (draft.companyName?.trim() || null),
    isConfidential: draft.isConfidential,
    confidentialDescriptor: draft.isConfidential ? draft.confidentialDescriptor!.trim() : null,
    function: draft.function,
    location: draft.location,
    isRemote: draft.isRemote,
    expMin: draft.expMin,
    expMax: draft.expMax,
    compText: draft.compText,
    applyMethod: draft.applyMethod,
    applyValue: draft.applyValue.trim(),
    jdUrl: draft.jdUrl,
    note: draft.note,
    connection: draft.connection,
    contactName: draft.connection === 'knows_contact' ? draft.contactName : null,
    rawPaste: draft.rawPaste,
    postedAt: now,
    postStatus: 'open',
    lastConfirmedAt: now,
  };

  s.posts = [...s.posts, post];
  commit();
  return post;
}

/**
 * Applying is a targeted disclosure to exactly one member (rule 2), so it
 * notifies exactly one member: the poster. Nobody else learns that it
 * happened, including the other applicants on the same post.
 *
 * You cannot apply to your own post. It is nonsense in the product — you would
 * be disclosing your details to yourself and then appear as your own applicant
 * on your own My-posts sheet — and it would notify you that you had applied to
 * you.
 */
export function applyToPost(postId: string, now: number = Date.now()): Application {
  const viewer = requireViewer();
  const s = getState();
  const post = s.posts.find((p) => p.id === postId);
  if (!post) throw new RuleViolation('No such post.', 'unknown_post');

  if (post.posterId === viewer.id) {
    throw new RuleViolation('You cannot apply to your own post.', 'self_apply');
  }
  if (s.applications.some((a) => a.jobPostId === postId && a.memberId === viewer.id)) {
    throw new RuleViolation('You have already applied to this role.', 'already_applied');
  }

  const application: Application = {
    id: nextId('a'),
    jobPostId: postId,
    memberId: viewer.id,
    appliedAt: now,
    status: 'yet_to_respond',
    statusUpdatedAt: now,
  };

  s.applications = [...s.applications, application];
  notify(
    s,
    post.posterId,
    'applied_to_your_post',
    { actorName: viewer.name, roleTitle: post.title },
    '/posts',
    now,
  );
  commit();
  return application;
}

/** Rule 3: your row, your status. Stamping the time is what resets staleness. */
export function setApplicationStatus(
  applicationId: string,
  status: ApplicationStatus,
  now: number = Date.now(),
): Application {
  const viewer = requireViewer();
  const s = getState();
  const application = s.applications.find((a) => a.id === applicationId);
  if (!application) throw new RuleViolation('No such application.', 'unknown_application');
  if (application.memberId !== viewer.id) {
    throw new RuleViolation('That is not your application.', 'not_yours');
  }

  const updated: Application = { ...application, status, statusUpdatedAt: now };
  s.applications = s.applications.map((a) => (a.id === applicationId ? updated : a));
  commit();
  return updated;
}

/**
 * Rule 3 again, on the other side. Marking a post filled is the one write that
 * fans out: everyone who applied is told, because a role that quietly stays on
 * the board after it is gone is the exact WhatsApp failure Lite exists to fix.
 */
export function setPostStatus(postId: string, status: PostStatus, now: number = Date.now()): JobPost {
  const viewer = requireViewer();
  const s = getState();
  const post = s.posts.find((p) => p.id === postId);
  if (!post) throw new RuleViolation('No such post.', 'unknown_post');
  if (post.posterId !== viewer.id) {
    throw new RuleViolation('That is not your post.', 'not_yours');
  }

  const updated: JobPost = { ...post, postStatus: status, lastConfirmedAt: now };
  s.posts = s.posts.map((p) => (p.id === postId ? updated : p));

  if (status === 'filled') {
    for (const a of s.applications.filter((x) => x.jobPostId === postId)) {
      notify(s, a.memberId, 'post_filled', { roleTitle: post.title }, '/applications', now);
    }
  }

  commit();
  return updated;
}

/**
 * §4: a report link plus an admin delete is the whole moderation story.
 *
 * A second report from the same member on the same post is refused, the same
 * way `applyToPost` refuses a second application: without this, the same
 * member re-clicking "Report" fills the admin queue with duplicates of a case
 * that is already sitting there.
 */
export function reportPost(postId: string, reason: string, now: number = Date.now()): Report {
  const viewer = requireViewer();
  const s = getState();
  const post = s.posts.find((p) => p.id === postId);
  if (!post) throw new RuleViolation('No such post.', 'unknown_post');
  if (post.posterId === viewer.id) {
    throw new RuleViolation('You cannot report your own post.', 'self_report');
  }
  if (s.reports.some((r) => r.jobPostId === postId && r.reporterId === viewer.id)) {
    throw new RuleViolation('You have already reported this post.', 'already_reported');
  }
  if (!reason?.trim()) {
    throw new RuleViolation('Say what is wrong with the post.', 'missing_reason');
  }

  const report: Report = {
    id: nextId('r'),
    jobPostId: postId,
    reporterId: viewer.id,
    reason: reason.trim(),
    at: now,
    resolvedAt: null,
  };

  s.reports = [...s.reports, report];
  commit();
  return report;
}

/**
 * The takedown. Admin-only: deleting a post removes it from every other
 * member's board and every applicant's sheet, which is not a judgement one
 * member gets to make about another's row.
 */
export function deletePost(postId: string, now: number = Date.now()): void {
  requireAdmin();
  const s = getState();
  if (!s.posts.some((p) => p.id === postId)) {
    throw new RuleViolation('No such post.', 'unknown_post');
  }
  s.posts = s.posts.filter((p) => p.id !== postId);
  s.reports = s.reports.map((r) => (r.jobPostId === postId && r.resolvedAt === null ? { ...r, resolvedAt: now } : r));
  commit();
}

export function markNotificationsRead(now: number = Date.now()): void {
  const viewer = viewerOrNull();
  if (!viewer) return;
  const s = getState();
  let changed = false;
  s.notifications = s.notifications.map((n) => {
    if (n.memberId !== viewer.id || n.readAt !== null) return n;
    changed = true;
    return { ...n, readAt: now };
  });
  // Only commit when something changed — an idle bell must not spin React.
  if (changed) commit();
}

export function savePushSubscription(endpoint: string, keys: string, now: number = Date.now()): void {
  const viewer = viewerOrNull();
  if (!viewer) return;
  const s = getState();
  if (s.pushSubscriptions.some((p) => p.memberId === viewer.id && p.endpoint === endpoint)) return;
  s.pushSubscriptions = [
    ...s.pushSubscriptions,
    { id: nextId('ps'), memberId: viewer.id, endpoint, keys, createdAt: now },
  ];
  commit();
}
