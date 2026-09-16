/**
 * The Lite demo workspace.
 *
 * Everything here is a pure function of `now`: no `Math.random()`, no
 * `Date.now()`, no iteration order this file did not itself choose. Ids are
 * literal strings. `buildSeed(now)` is byte-identical across calls, and
 * `test/seed.test.ts` pins that with a `JSON.stringify` comparison — the store
 * and its tests depend on it.
 *
 * The five job posts are not invented: they are §5.0's real WhatsApp-forward
 * corpus, run through the actual parser (`parsePost`) so the demo exercises the
 * same code path a real paste would. Only what the parser cannot know — who
 * posted it, at what rung, the function, and (for the three that withhold the
 * company) the confidential descriptor — is filled in by hand. The titles are
 * hand-written too, deliberately: the parser's best guess at MSG_2 is "for a
 * Strategy role with…", which is a fragment, not a role. §9's rule is that the
 * parser pre-fills a form a human confirms, and this seed is what "a human
 * confirmed it" looks like.
 *
 * Lite has no duplicate-merge and therefore no `dedupeHash`: §1 drops it
 * outright below a few hundred posts, and §7's `job_post` has no such column.
 * Two posts of the same role simply appear twice.
 */
import { SCHEMA_VERSION } from './schema.ts';
import type {
  Application,
  Connection,
  FunctionArea,
  JobPost,
  Member,
  Notification,
  PostStatus,
  PushSubscription,
  Report,
} from './schema.ts';
import { parsePost } from '../core/parse.ts';
import { notificationBody } from '../core/notifications.ts';
import { DAY_MS } from '../core/time.ts';
import {
  MSG_1_CONFIDENTIAL_STARTUP,
  MSG_2_PHONE_ROUTE,
  MSG_3_SEARCH_FIRM,
  MSG_4_NAMED_COMPANY,
  MSG_5_CAREERS_EMAIL,
} from './messages.ts';

export interface AppState {
  version: number;
  members: Member[];
  posts: JobPost[];
  applications: Application[];
  notifications: Notification[];
  pushSubscriptions: PushSubscription[];
  reports: Report[];
  /** `null` once the member signs out — the state Login exists to be reached from. */
  currentMemberId: string | null;
  /**
   * A Google identity with no matching `Member` row yet — set only by
   * `store.beginNewSignIn`, the demo's stand-in for "the visitor picked an
   * account Google returned that Loop has never seen." `null` the rest of
   * the time. See `store.ts` for why this lives here rather than in a
   * component.
   */
  newSignIn: GoogleIdentity | null;
}

export interface GoogleIdentity {
  googleSub: string;
  email: string;
}

interface PostSpec {
  id: string;
  posterId: string;
  title: string;
  function: FunctionArea;
  connection: Connection;
  contactName?: string | null;
  companyName?: string | null;
  isConfidential?: boolean;
  confidentialDescriptor?: string | null;
  note?: string | null;
  postedAt: number;
  postStatus?: PostStatus;
}

/**
 * The parser fills what a paste actually states — location, experience band,
 * compensation line, apply route, JD link — and the spec supplies the four
 * things it cannot know. A post is the union, never a guess.
 */
function postFromMessage(raw: string, o: PostSpec): JobPost {
  const p = parsePost(raw);
  const locations = p.locations.value ?? [];
  const confidential = o.isConfidential ?? false;
  return {
    id: o.id,
    posterId: o.posterId,
    title: o.title,
    companyName: confidential ? null : (o.companyName ?? null),
    isConfidential: confidential,
    confidentialDescriptor: confidential ? (o.confidentialDescriptor ?? null) : null,
    function: o.function,
    location: locations.filter((l) => l !== 'Remote').join(', '),
    isRemote: locations.includes('Remote'),
    expMin: p.experience.value?.min ?? 0,
    expMax: p.experience.value?.max ?? 0,
    compText: p.compensation.value,
    applyMethod: p.applyMethod.value ?? 'email',
    applyValue: p.applyValue.value ?? '',
    jdUrl: p.jdUrl.value,
    note: o.note ?? null,
    connection: o.connection,
    contactName: o.contactName ?? null,
    rawPaste: raw,
    postedAt: o.postedAt,
    postStatus: o.postStatus ?? 'open',
    lastConfirmedAt: o.postedAt,
  };
}

export function buildSeed(now: number): AppState {
  const days = (n: number): number => now - n * DAY_MS;

  // -------------------------------------------------------------------------
  // Members — every gate state the product has, and both verification routes.
  //
  // Ananya is first deliberately: she is the current member, and the store
  // tests reach for "the first verified non-admin" as the ordinary seeker.
  // -------------------------------------------------------------------------
  const members: Member[] = [
    {
      id: 'm_ananya', googleSub: 'g_ananya', email: 'ananya.rao@astra.xlri.ac.in',
      name: 'Ananya Rao', batch: 2021, programme: 'BM',
      linkedinUrl: 'https://linkedin.com/in/ananyarao', knownBy: null,
      verifiedBy: 'domain', status: 'verified', isAdmin: false,
      requestedAt: days(200), decidedAt: days(200), decidedById: null,
      decisionNote: 'Institute address — verified instantly, no reviewer needed.',
    },
    {
      id: 'm_rohit', googleSub: 'g_rohit', email: 'rohit.mehta@gmail.com',
      name: 'Rohit Mehta', batch: 2016, programme: 'HRM',
      linkedinUrl: 'https://linkedin.com/in/rohitmehta', knownBy: 'Meera Iyer',
      verifiedBy: 'admin', status: 'verified', isAdmin: false,
      requestedAt: days(181), decidedAt: days(180), decidedById: 'm_admin',
      decisionNote: 'LinkedIn education entry matches batch records.',
    },
    {
      id: 'm_meera', googleSub: 'g_meera', email: 'meera.iyer@foodhak.com',
      name: 'Meera Iyer', batch: 2014, programme: 'BM',
      linkedinUrl: 'https://linkedin.com/in/meeraiyer', knownBy: 'Partho Sen',
      verifiedBy: 'admin', status: 'verified', isAdmin: false,
      requestedAt: days(171), decidedAt: days(170), decidedById: 'm_admin',
      decisionNote: 'LinkedIn education entry matches batch records.',
    },
    {
      id: 'm_partho', googleSub: 'g_partho', email: 'partho.sen@outlook.com',
      name: 'Partho Sen', batch: 2012, programme: 'PGDM (GM)',
      linkedinUrl: 'https://linkedin.com/in/parthosen', knownBy: null,
      verifiedBy: 'admin', status: 'verified', isAdmin: false,
      requestedAt: days(161), decidedAt: days(160), decidedById: 'm_admin',
      decisionNote: 'LinkedIn education entry matches batch records.',
    },
    {
      id: 'm_karan', googleSub: 'g_karan', email: 'karan.shah@gmail.com',
      name: 'Karan Shah', batch: 2018, programme: 'BM',
      linkedinUrl: 'https://linkedin.com/in/karanshah', knownBy: 'Ananya Rao',
      verifiedBy: 'admin', status: 'verified', isAdmin: false,
      requestedAt: days(151), decidedAt: days(150), decidedById: 'm_admin',
      decisionNote: 'LinkedIn education entry matches batch records.',
    },
    {
      id: 'm_admin', googleSub: 'g_admin', email: 'alumni.office@astra.xlri.ac.in',
      name: 'Alumni Office', batch: 2009, programme: 'GMP',
      linkedinUrl: 'https://linkedin.com/company/xlri', knownBy: null,
      verifiedBy: 'domain', status: 'verified', isAdmin: true,
      requestedAt: days(300), decidedAt: days(300), decidedById: null,
      decisionNote: 'Staff account.',
    },
    // The one case waiting in the admin queue — full evidence, undecided.
    {
      id: 'm_devika', googleSub: 'g_devika', email: 'devika.nair@gmail.com',
      name: 'Devika Nair', batch: 2019, programme: 'HRM',
      linkedinUrl: 'https://linkedin.com/in/devikanair', knownBy: 'Rohit Mehta',
      verifiedBy: null, status: 'pending', isAdmin: false,
      requestedAt: days(2), decidedAt: null, decidedById: null, decisionNote: '',
    },
    // A refusal, with the reason recorded — §3 says every decision carries one.
    {
      id: 'm_vikram', googleSub: 'g_vikram', email: 'recruiter.reach@outlook.com',
      name: 'Vikram Bose', batch: 2015, programme: 'Other',
      linkedinUrl: 'https://linkedin.com/in/vikrambose', knownBy: null,
      verifiedBy: null, status: 'rejected', isAdmin: false,
      requestedAt: days(13), decidedAt: days(12), decidedById: 'm_admin',
      decisionNote: 'No XLRI education entry on the LinkedIn profile provided.',
    },
  ];

  // -------------------------------------------------------------------------
  // Posts — §5.0's five real messages, parsed, with the four hand-filled fields.
  //
  // All four connection values appear, so the board demonstrates its ranking.
  // One post is 34 days old so the greying is visible; one was posted today.
  // -------------------------------------------------------------------------
  const posts: JobPost[] = [
    postFromMessage(MSG_1_CONFIDENTIAL_STARTUP, {
      id: 'p_impact', posterId: 'm_rohit',
      title: 'Associate Director – People & Culture',
      function: 'HR', connection: 'works_here',
      isConfidential: true, confidentialDescriptor: 'Impact-tech startup, ₹300Cr revenue, marquee investors',
      note: 'Happy to flag your profile internally once you have applied.',
      postedAt: days(12),
    }),
    postFromMessage(MSG_2_PHONE_ROUTE, {
      id: 'p_insurer', posterId: 'm_partho',
      title: 'Strategy Manager',
      function: 'Strategy & Consulting', connection: 'knows_contact', contactName: 'Nikita',
      isConfidential: true, confidentialDescriptor: 'Mumbai-based MNC insurer',
      postedAt: days(6),
    }),
    postFromMessage(MSG_3_SEARCH_FIRM, {
      id: 'p_cbo', posterId: 'm_karan',
      title: 'Chief Business Officer',
      function: 'General Management', connection: 'forwarded',
      isConfidential: true, confidentialDescriptor: 'Healthcare services and wellness organisation',
      note: 'Came through a search firm — I have no line into this one.',
      postedAt: days(34), postStatus: 'filled',
    }),
    postFromMessage(MSG_4_NAMED_COMPANY, {
      id: 'p_foodhak', posterId: 'm_meera',
      title: 'Brand Marketing Manager',
      function: 'Marketing & Brand', connection: 'hiring',
      companyName: 'FOODHAK',
      postedAt: days(21),
    }),
    postFromMessage(MSG_5_CAREERS_EMAIL, {
      id: 'p_anveshan', posterId: 'm_rohit',
      title: 'Head of Operations',
      function: 'Operations & Supply Chain', connection: 'works_here',
      companyName: 'Anveshan',
      postedAt: now,
    }),
  ];

  // -------------------------------------------------------------------------
  // Applications — Ananya's three span the ladder (one stale, one mid, one
  // terminal), and Meera's post carries four so "My posts" has a row worth
  // expanding.
  // -------------------------------------------------------------------------
  const applications: Application[] = [
    {
      id: 'a_1', jobPostId: 'p_foodhak', memberId: 'm_ananya',
      appliedAt: days(20), status: 'yet_to_respond', statusUpdatedAt: days(20),
    },
    {
      id: 'a_2', jobPostId: 'p_impact', memberId: 'm_ananya',
      appliedAt: days(11), status: 'interview_scheduled', statusUpdatedAt: days(3),
    },
    {
      id: 'a_3', jobPostId: 'p_cbo', memberId: 'm_ananya',
      appliedAt: days(30), status: 'rejected', statusUpdatedAt: days(5),
    },
    {
      id: 'a_4', jobPostId: 'p_foodhak', memberId: 'm_rohit',
      appliedAt: days(19), status: 'in_review', statusUpdatedAt: days(9),
    },
    {
      id: 'a_5', jobPostId: 'p_foodhak', memberId: 'm_partho',
      appliedAt: days(18), status: 'awaiting_next_round', statusUpdatedAt: days(2),
    },
    {
      id: 'a_6', jobPostId: 'p_foodhak', memberId: 'm_karan',
      appliedAt: days(17), status: 'no_response', statusUpdatedAt: days(6),
    },
  ];

  // -------------------------------------------------------------------------
  // Notifications — one read and one unread for the current member, so the
  // bell count is a real number rather than all-or-nothing, plus one waiting
  // for the poster who has applicants.
  // -------------------------------------------------------------------------
  const notifications: Notification[] = [
    {
      id: 'n_1', memberId: 'm_ananya', kind: 'you_were_verified',
      body: notificationBody('you_were_verified', {}), link: '/board',
      readAt: days(199), pushedAt: days(200), emailedAt: null, at: days(200),
    },
    {
      id: 'n_2', memberId: 'm_ananya', kind: 'post_filled',
      body: notificationBody('post_filled', { roleTitle: 'Chief Business Officer' }),
      link: '/applications', readAt: null, pushedAt: null, emailedAt: null, at: days(5),
    },
    {
      id: 'n_3', memberId: 'm_meera', kind: 'applied_to_your_post',
      body: notificationBody('applied_to_your_post', { actorName: 'Partho Sen', roleTitle: 'Brand Marketing Manager' }),
      link: '/posts', readAt: null, pushedAt: null, emailedAt: null, at: days(18),
    },
  ];

  // §4: a report link plus an admin delete is the whole moderation story, so
  // the queue needs something in it to be worth opening.
  const reports: Report[] = [
    {
      id: 'r_1', jobPostId: 'p_cbo', reporterId: 'm_ananya',
      reason: 'Search firm never replied — possibly collecting CVs rather than hiring.',
      at: days(9), resolvedAt: null,
    },
  ];

  return {
    version: SCHEMA_VERSION,
    members,
    posts,
    applications,
    notifications,
    pushSubscriptions: [],
    reports,
    currentMemberId: 'm_ananya',
    newSignIn: null,
  };
}
