/**
 * The demo network (Task 14).
 *
 * Everything here is a pure function of `now`: no `Math.random()`, no
 * `Date.now()`, no iteration order this file did not itself choose. The
 * filler alumni are generated from their loop index `i` by modular
 * arithmetic over fixed arrays, so `buildSeed(now)` is byte-identical across
 * calls — the store (Task 15) and its tests depend on that.
 *
 * The five job posts are not invented: they are §5.0's real WhatsApp-forward
 * corpus, run through the actual parser (`parsePost`) so the demo exercises
 * the same code path a real paste would. Only what the parser cannot know —
 * who posted it, at what rung, and (for the three that withhold the company)
 * the confidential descriptor — is filled in by hand.
 */
import { SCHEMA_VERSION } from './schema.ts';
import type {
  Company,
  DeclineReason,
  JobPost,
  Member,
  MemberStatus,
  PostApplication,
  PostShare,
  PrivacySettings,
  ReferralRequest,
  RequestEvent,
  RequestState,
  Report,
  ResumeVersion,
  School,
  VerificationCase,
  VerificationTier,
  Vouch,
} from './schema.ts';
import { inferDestination, parsePost } from '../core/parse.ts';
import { dedupeHash } from '../core/dedupe.ts';
import { addDays, DAY_MS } from '../core/time.ts';
import { applyTransition, RESPONSE_WINDOW_DAYS } from '../core/requests.ts';
import {
  MSG_1_CONFIDENTIAL_STARTUP,
  MSG_2_PHONE_ROUTE,
  MSG_3_SEARCH_FIRM,
  MSG_4_NAMED_COMPANY,
  MSG_5_CAREERS_EMAIL,
} from './messages.ts';

export interface AppState {
  version: number;
  school: School;
  members: Member[];
  companies: Company[];
  posts: JobPost[];
  shares: PostShare[];
  applications: PostApplication[];
  requests: ReferralRequest[];
  requestEvents: RequestEvent[];
  cases: VerificationCase[];
  resumes: ResumeVersion[];
  vouches: Vouch[];
  reports: Report[];
  currentMemberId: string;
}

type Caps = Member['caps'];

const noCaps = (): Caps => ({ maxOpen: 0, maxPerMonth: 0, paused: false, autoDeclineMessage: '' });

const defaultPrivacy = (overrides: Partial<PrivacySettings> = {}): PrivacySettings => ({
  confidentialSearch: false,
  blockedCompanyIds: [],
  blockedMemberIds: [],
  ...overrides,
});

const evidenceFor = (m: Member) => ({
  linkedinUrl: m.linkedinUrl ?? '',
  batch: m.batch,
  programme: m.programme,
  nameAtGraduation: m.name,
});

// ---------------------------------------------------------------------------
// Companies — 30 that the filler alumni cycle through, plus one confidential
// employer (Rohit's) that never appears on a public post.
// ---------------------------------------------------------------------------

interface CompanySeed { id: string; name: string; domain: string | null }

const FIXED_COMPANIES: CompanySeed[] = [
  { id: 'c_foodhak', name: 'Foodhak', domain: 'foodhak.com' },
  { id: 'c_anveshan', name: 'Anveshan', domain: 'anveshan.farm' },
  { id: 'c_tcs', name: 'Tata Consultancy Services', domain: 'tcs.com' },
  { id: 'c_infosys', name: 'Infosys', domain: 'infosys.com' },
  { id: 'c_hul', name: 'Hindustan Unilever', domain: 'hul.co.in' },
  { id: 'c_itc', name: 'ITC Limited', domain: 'itc.in' },
  { id: 'c_deloitte', name: 'Deloitte', domain: 'deloitte.com' },
  { id: 'c_mckinsey', name: 'McKinsey & Company', domain: 'mckinsey.com' },
  { id: 'c_amazon', name: 'Amazon', domain: 'amazon.com' },
  { id: 'c_flipkart', name: 'Flipkart', domain: 'flipkart.com' },
  { id: 'c_swiggy', name: 'Swiggy', domain: 'swiggy.in' },
  { id: 'c_zomato', name: 'Zomato', domain: 'zomato.com' },
  { id: 'c_paytm', name: 'Paytm', domain: 'paytm.com' },
  { id: 'c_phonepe', name: 'PhonePe', domain: 'phonepe.com' },
  { id: 'c_reliance', name: 'Reliance Industries', domain: 'ril.com' },
  { id: 'c_adityabirla', name: 'Aditya Birla Group', domain: 'adityabirla.com' },
  { id: 'c_bajajfinserv', name: 'Bajaj Finserv', domain: 'bajajfinserv.in' },
  { id: 'c_hdfcbank', name: 'HDFC Bank', domain: 'hdfcbank.com' },
  { id: 'c_icicibank', name: 'ICICI Bank', domain: 'icicibank.com' },
  { id: 'c_axisbank', name: 'Axis Bank', domain: 'axisbank.com' },
  { id: 'c_wipro', name: 'Wipro', domain: 'wipro.com' },
  { id: 'c_accenture', name: 'Accenture', domain: 'accenture.com' },
  { id: 'c_ey', name: 'EY', domain: 'ey.com' },
  { id: 'c_kpmg', name: 'KPMG', domain: 'kpmg.com' },
  { id: 'c_pwc', name: 'PwC', domain: 'pwc.com' },
  { id: 'c_nykaa', name: 'Nykaa', domain: 'nykaa.com' },
  { id: 'c_byjus', name: "BYJU'S", domain: 'byjus.com' },
  { id: 'c_ola', name: 'Ola', domain: 'olacabs.com' },
  { id: 'c_myntra', name: 'Myntra', domain: 'myntra.com' },
  { id: 'c_tatamotors', name: 'Tata Motors', domain: 'tatamotors.com' },
];

const EXTRA_COMPANIES: CompanySeed[] = [
  // Rohit's employer for the §5.0 confidential startup post — never disclosed
  // on the card itself (JobPost.companyId stays null there), only known here.
  { id: 'c_impactco', name: 'ImpactCo', domain: 'impactco.com' },
];

const ALL_COMPANIES: Company[] = [...FIXED_COMPANIES, ...EXTRA_COMPANIES].map((c) => ({ ...c }));

// ---------------------------------------------------------------------------
// Filler-generation vocabulary — fixed arrays, indexed deterministically.
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Aarav', 'Vihaan', 'Aditi', 'Diya', 'Kabir', 'Ishaan', 'Myra', 'Advait',
  'Reyansh', 'Saanvi', 'Arjun', 'Kiara', 'Vivaan', 'Anaya', 'Rudra', 'Pihu',
  'Dhruv', 'Ira', 'Yash', 'Tara', 'Nikhil', 'Pooja', 'Rahul', 'Sneha',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Iyer', 'Nair', 'Menon', 'Rao', 'Reddy',
  'Shah', 'Mehta', 'Kapoor', 'Malhotra', 'Chopra', 'Bose', 'Sen', 'Das',
  'Pillai', 'Krishnan', 'Joshi', 'Kulkarni', 'Bhatt', 'Chatterjee', 'Mukherjee', 'Agarwal',
];
const FUNCTIONS = [
  'Strategy', 'Marketing', 'Finance', 'HR', 'Operations',
  'Sales', 'Product', 'Consulting', 'Analytics', 'Supply Chain',
];
const LOCATIONS = [
  'Bangalore', 'Mumbai', 'Delhi', 'Gurgaon', 'Pune',
  'Hyderabad', 'Chennai', 'Kolkata', 'Remote', 'Singapore',
];
const PROGRAMMES = ['BM', 'HRM', 'GM'];

const FILLER_COUNT = 220;

/** Three exceptional statuses, deliberately placed at indices whose company
 * occurrence rank (k) is >= 3 — so no company ever loses one of its
 * guaranteed three open-to-referring alumni to an unverified filler. */
const EXCEPTION_STATUS: Record<number, MemberStatus> = {
  111: 'pending',
  148: 'unverified',
  185: 'rejected',
};

/** m_fill_200 demonstrates the Tier C / vouching path rather than A or B. */
const TIER_OVERRIDE: Record<number, VerificationTier> = { 200: 'C' };

function buildFillerMembers(now: number, schoolId: string): Member[] {
  const members: Member[] = [];
  for (let i = 0; i < FILLER_COUNT; i++) {
    const id = `m_fill_${i}`;
    const co = FIXED_COMPANIES[i % FIXED_COMPANIES.length];
    const k = Math.floor(i / FIXED_COMPANIES.length); // occurrence rank within that company
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length];
    const batch = 2005 + (i % 20);
    const programme = PROGRAMMES[i % PROGRAMMES.length];
    const fn = FUNCTIONS[i % FUNCTIONS.length];
    const loc = LOCATIONS[(i + 2) % LOCATIONS.length];

    const status: MemberStatus = EXCEPTION_STATUS[i] ?? 'verified';
    const useAstra = i % 5 === 0;
    const domain = useAstra ? 'astra.xlri.ac.in' : 'gmail.com';
    const email = `${first.toLowerCase()}.${last.toLowerCase()}.${i}@${domain}`;
    const tier: VerificationTier | null =
      status === 'verified' ? (TIER_OVERRIDE[i] ?? (useAstra ? 'A' : 'B')) : null;

    // §7.1 / DL1: at least three verified alumni per company must accept
    // referrals unimpeded — the first three occurrences of each company
    // (k = 0, 1, 2) are always among them.
    const isGuaranteedOpen = k < 3;
    const isCasualOpen = i % 4 === 0;
    const openToReferring = status === 'verified' && (isGuaranteedOpen || isCasualOpen);
    const caps: Caps = !openToReferring
      ? noCaps()
      : isGuaranteedOpen
        ? { maxOpen: 5, maxPerMonth: 5, paused: false, autoDeclineMessage: "Happy to help — I'll get back to you within a few days." }
        : { maxOpen: 2, maxPerMonth: 2, paused: i % 8 === 0, autoDeclineMessage: 'At capacity for now — please check back next month.' };

    members.push({
      id,
      schoolId,
      googleSub: `gsub_${id}`,
      email,
      name: `${first} ${last}`,
      batch,
      programme,
      status,
      tier,
      isAdmin: false,
      companyId: co.id,
      title: `${fn} ${k === 0 ? 'Lead' : 'Associate'}`,
      function: fn,
      location: loc,
      linkedinUrl: `https://linkedin.com/in/${id}`,
      openToReferring,
      caps,
      privacy: defaultPrivacy({ confidentialSearch: i % 6 === 0 }),
      resumeVersionId: null,
      joinedAt: now - ((i % 365) + 30) * DAY_MS,
    });
  }
  return members;
}

// ---------------------------------------------------------------------------
// Job posts — the five §5.0 messages, parsed for real, annotated by hand only
// where the parser is deliberately silent (D13/D14: relationship rung, and,
// for the three that withhold the company, the confidential descriptor).
// ---------------------------------------------------------------------------

interface FixturePostInput {
  id: string;
  posterId: string;
  companyId: string | null;
  confidentialDescriptor: string | null;
  raw: string;
  // Required, like every other judgement field below (`companyId`,
  // `confidentialDescriptor`, `posterRelationship`, `hiringContactName`) —
  // never taken from the parser. §9 requires a human to confirm a parsed
  // title before a post publishes; a seeded post represents one that already
  // passed that step, so its title is a human input here too, not a parser
  // guess threaded straight through. See MSG_2's fixture below for why this
  // was made required rather than merely overridden.
  title: string;
  posterRelationship: JobPost['posterRelationship'];
  hiringContactName: string | null;
  functionLabel: string | null;
  postedAt: number;
  lastConfirmedAt: number;
}

function buildFixturePost(input: FixturePostInput): JobPost {
  const parsed = parsePost(input.raw);
  const title = input.title;
  const locations = parsed.locations.value ?? [];
  const exp = parsed.experience.value;
  const applyMethod = parsed.applyMethod.value ?? 'link';
  const applyValue = parsed.applyValue.value ?? '';
  const destinationType = parsed.destination.value ?? inferDestination(applyMethod, applyValue).value;

  return {
    id: input.id,
    posterId: input.posterId,
    companyId: input.companyId,
    confidentialDescriptor: input.confidentialDescriptor,
    title,
    locations,
    expMin: exp?.min ?? null,
    expMax: exp?.max ?? null,
    compText: parsed.compensation.value,
    function: input.functionLabel,
    applyMethod,
    applyValue,
    jdUrl: parsed.jdUrl.value,
    posterRelationship: input.posterRelationship,
    destinationType,
    hiringContactName: input.hiringContactName,
    hiringContactValue: destinationType === 'named_person' ? applyValue : null,
    contactConsentConfirmed: true,
    contactRemovalRequestedAt: null,
    rawText: parsed.raw,
    parseConfidence: parsed.overallConfidence,
    dedupeHash: dedupeHash(applyValue, title),
    postedAt: input.postedAt,
    lastConfirmedAt: input.lastConfirmedAt,
    confirmState: 'open',
    archivedAt: null,
    viewCount: 0,
    unreachableFlags: [],
    reportedBy: [],
  };
}

// ---------------------------------------------------------------------------
// Requests — built through the real state machine (core/requests.ts) so the
// seeded data can never disagree with the rules the store enforces at runtime.
// ---------------------------------------------------------------------------

interface RequestBase {
  id: string;
  seekerId: string;
  referrerId: string;
  companyId: string;
  jobPostId: string | null;
  roleUrl: string | null;
  roleTitle: string;
  resumeVersionId: string | null;
  pitch: string;
  createdAt: number;
}

interface RequestStep {
  to: RequestState;
  role: 'seeker' | 'referrer' | 'system';
  at: number;
  note: string;
  declineReason?: DeclineReason;
}

function buildRequestTimeline(base: RequestBase, steps: RequestStep[]): { request: ReferralRequest; events: RequestEvent[] } {
  let request: ReferralRequest = {
    id: base.id,
    seekerId: base.seekerId,
    referrerId: base.referrerId,
    companyId: base.companyId,
    jobPostId: base.jobPostId,
    roleUrl: base.roleUrl,
    roleTitle: base.roleTitle,
    resumeVersionId: base.resumeVersionId,
    pitch: base.pitch,
    state: 'sent',
    stateOwner: 'referrer',
    declineReason: null,
    nextUpdateDue: addDays(base.createdAt, RESPONSE_WINDOW_DAYS),
    nudgeCount: 0,
    lastNudgedAt: null,
    createdAt: base.createdAt,
    updatedAt: base.createdAt,
  };

  const events: RequestEvent[] = [
    {
      id: `${base.id}_ev0`,
      requestId: base.id,
      actorId: base.seekerId,
      fromState: null,
      toState: 'sent',
      note: 'Request sent.',
      at: base.createdAt,
    },
  ];

  steps.forEach((step, idx) => {
    const from = request.state;
    request = applyTransition(request, step.to, step.role, step.at, { declineReason: step.declineReason });
    events.push({
      id: `${base.id}_ev${idx + 1}`,
      requestId: base.id,
      actorId: step.role === 'system' ? null : step.role === 'referrer' ? base.referrerId : base.seekerId,
      fromState: from,
      toState: step.to,
      note: step.note,
      at: step.at,
    });
  });

  return { request, events };
}

// ---------------------------------------------------------------------------
// buildSeed
// ---------------------------------------------------------------------------

export function buildSeed(now: number): AppState {
  const school: School = { id: 'sch_xlri', name: 'XLRI Jamshedpur', verifiedDomains: ['astra.xlri.ac.in'] };

  // -- Named §4 personas ----------------------------------------------------

  const ananya: Member = {
    id: 'm_ananya',
    schoolId: school.id,
    googleSub: 'gsub_m_ananya',
    email: 'ananya.rao@astra.xlri.ac.in',
    name: 'Ananya Rao',
    batch: 2026,
    programme: 'BM',
    status: 'verified',
    tier: 'A',
    isAdmin: false,
    companyId: null,
    title: null,
    function: null,
    location: 'Jamshedpur',
    linkedinUrl: 'https://linkedin.com/in/m_ananya',
    openToReferring: false,
    caps: noCaps(),
    privacy: defaultPrivacy({ confidentialSearch: true }),
    resumeVersionId: 'res_ananya_v1',
    joinedAt: now - 40 * DAY_MS,
  };

  const rohit: Member = {
    id: 'm_rohit',
    schoolId: school.id,
    googleSub: 'gsub_m_rohit',
    email: 'rohit.mehta.hrm@gmail.com',
    name: 'Rohit Mehta',
    batch: 2019,
    programme: 'HRM',
    status: 'verified',
    tier: 'B',
    isAdmin: false,
    companyId: 'c_impactco',
    title: 'AVP - People & Culture',
    function: 'HR',
    location: 'Bangalore',
    linkedinUrl: 'https://linkedin.com/in/m_rohit',
    openToReferring: true,
    caps: { maxOpen: 2, maxPerMonth: 3, paused: false, autoDeclineMessage: 'Swamped this quarter — try me in January.' },
    privacy: defaultPrivacy(),
    resumeVersionId: null,
    joinedAt: now - 2500 * DAY_MS,
  };

  const meera: Member = {
    id: 'm_meera',
    schoolId: school.id,
    googleSub: 'gsub_m_meera',
    email: 'meera.iyer@foodhak.com',
    name: 'Meera Iyer',
    batch: 2012,
    programme: 'BM',
    status: 'verified',
    tier: 'B',
    isAdmin: false,
    companyId: 'c_foodhak',
    title: 'Director',
    function: 'Marketing',
    location: 'UK',
    linkedinUrl: 'https://linkedin.com/in/m_meera',
    openToReferring: true,
    caps: { maxOpen: 5, maxPerMonth: 5, paused: false, autoDeclineMessage: 'Happy to help — response may take a few days.' },
    privacy: defaultPrivacy(),
    resumeVersionId: null,
    joinedAt: now - 5000 * DAY_MS,
  };

  const partho: Member = {
    id: 'm_partho',
    schoolId: school.id,
    googleSub: 'gsub_m_partho',
    email: 'partho.ghosh@gmail.com',
    name: 'Partho Ghosh',
    batch: 2009,
    programme: 'BM',
    status: 'verified',
    tier: 'B',
    isAdmin: false,
    companyId: null,
    title: 'Independent Consultant',
    function: 'Consulting',
    location: 'Delhi',
    linkedinUrl: 'https://linkedin.com/in/m_partho',
    openToReferring: false,
    caps: noCaps(),
    privacy: defaultPrivacy(),
    resumeVersionId: null,
    joinedAt: now - 6200 * DAY_MS,
  };

  const karan: Member = {
    id: 'm_karan',
    schoolId: school.id,
    googleSub: 'gsub_m_karan',
    email: 'karan.shah@gmail.com',
    name: 'Karan Shah',
    batch: 2020,
    programme: 'BM',
    status: 'verified',
    tier: 'B',
    isAdmin: false,
    companyId: 'c_mckinsey',
    title: 'Senior Associate',
    function: 'Consulting',
    location: 'Mumbai',
    linkedinUrl: 'https://linkedin.com/in/m_karan',
    openToReferring: false,
    caps: noCaps(),
    // Privacy-critical (§6/D6): Karan does not want colleagues at his own
    // employer to discover he is on the network at all.
    privacy: defaultPrivacy({ confidentialSearch: true, blockedCompanyIds: ['c_mckinsey'] }),
    resumeVersionId: null,
    joinedAt: now - 2100 * DAY_MS,
  };

  const admin: Member = {
    id: 'm_admin',
    schoolId: school.id,
    googleSub: 'gsub_m_admin',
    email: 'admin@astra.xlri.ac.in',
    name: 'Admin Desk',
    batch: 2000,
    programme: 'Admin',
    status: 'verified',
    tier: 'A',
    isAdmin: true,
    companyId: null,
    title: 'Alumni Relations',
    function: 'Administration',
    location: 'Jamshedpur',
    linkedinUrl: 'https://linkedin.com/in/m_admin',
    openToReferring: false,
    caps: noCaps(),
    privacy: defaultPrivacy(),
    resumeVersionId: null,
    joinedAt: now - 8000 * DAY_MS,
  };

  const fillerMembers = buildFillerMembers(now, school.id);
  const members: Member[] = [ananya, rohit, meera, partho, karan, admin, ...fillerMembers];

  // -- Verification cases & vouches -----------------------------------------

  const cases: VerificationCase[] = [
    { id: 'case_ananya', memberId: ananya.id, tier: 'A', evidence: evidenceFor(ananya), decision: 'approved', reviewerId: null, decidedAt: ananya.joinedAt, notes: 'Domain match — instant.', isAppeal: false, submittedAt: ananya.joinedAt },
    { id: 'case_rohit', memberId: rohit.id, tier: 'B', evidence: evidenceFor(rohit), decision: 'approved', reviewerId: admin.id, decidedAt: rohit.joinedAt + DAY_MS, notes: 'LinkedIn education entry matches batch records.', isAppeal: false, submittedAt: rohit.joinedAt },
    { id: 'case_meera', memberId: meera.id, tier: 'B', evidence: evidenceFor(meera), decision: 'approved', reviewerId: admin.id, decidedAt: meera.joinedAt + DAY_MS, notes: 'LinkedIn education entry matches batch records.', isAppeal: false, submittedAt: meera.joinedAt },
    { id: 'case_partho', memberId: partho.id, tier: 'B', evidence: evidenceFor(partho), decision: 'approved', reviewerId: admin.id, decidedAt: partho.joinedAt + DAY_MS, notes: 'LinkedIn education entry matches batch records.', isAppeal: false, submittedAt: partho.joinedAt },
    { id: 'case_karan', memberId: karan.id, tier: 'B', evidence: evidenceFor(karan), decision: 'approved', reviewerId: admin.id, decidedAt: karan.joinedAt + DAY_MS, notes: 'LinkedIn education entry matches batch records.', isAppeal: false, submittedAt: karan.joinedAt },
    { id: 'case_admin', memberId: admin.id, tier: 'A', evidence: evidenceFor(admin), decision: 'approved', reviewerId: admin.id, decidedAt: admin.joinedAt, notes: 'Staff account.', isAppeal: false, submittedAt: admin.joinedAt },
    // A pending Tier B case — an admin still has to look at this one.
    {
      id: 'case_fill_111_pending',
      memberId: 'm_fill_111',
      tier: 'B',
      evidence: evidenceFor(fillerMembers[111]),
      decision: 'pending',
      reviewerId: null,
      decidedAt: null,
      notes: '',
      isAppeal: false,
      submittedAt: now - 2 * DAY_MS,
    },
    // A rejected case, eligible for the one appeal §6 allows.
    {
      id: 'case_fill_185_rejected',
      memberId: 'm_fill_185',
      tier: 'B',
      evidence: evidenceFor(fillerMembers[185]),
      decision: 'rejected',
      reviewerId: admin.id,
      decidedAt: now - 10 * DAY_MS,
      notes: 'LinkedIn education entry could not be corroborated against batch records.',
      isAppeal: false,
      submittedAt: now - 15 * DAY_MS,
    },
    // Tier C via vouching (§6), once the network clears the unlock threshold.
    {
      id: 'case_fill_200_tierc',
      memberId: 'm_fill_200',
      tier: 'C',
      evidence: evidenceFor(fillerMembers[200]),
      decision: 'approved',
      reviewerId: admin.id,
      decidedAt: now - 5 * DAY_MS,
      notes: 'Two vouches received; no LinkedIn record to check against.',
      isAppeal: false,
      submittedAt: now - 6 * DAY_MS,
    },
  ];

  const vouches: Vouch[] = [
    { id: 'v_1', caseId: 'case_fill_200_tierc', voucherId: 'm_fill_201', at: now - 7 * DAY_MS },
    { id: 'v_2', caseId: 'case_fill_200_tierc', voucherId: 'm_fill_202', at: now - 6 * DAY_MS },
  ];

  // -- Posts (the five §5.0 messages) ---------------------------------------

  const pImpactco = buildFixturePost({
    id: 'p_impactco',
    posterId: rohit.id,
    companyId: null,
    confidentialDescriptor: 'impact-tech startup, ₹300Cr revenue',
    raw: MSG_1_CONFIDENTIAL_STARTUP,
    title: 'AD/Director - People & Culture',
    posterRelationship: 'internal_can_refer',
    hiringContactName: null,
    functionLabel: 'People & Culture',
    postedAt: now - 6 * DAY_MS,
    lastConfirmedAt: now - 6 * DAY_MS,
  });

  const pMncInsurer = buildFixturePost({
    id: 'p_mnc_insurer',
    posterId: partho.id,
    companyId: null,
    confidentialDescriptor: 'Mumbai-based MNC insurer',
    raw: MSG_2_PHONE_ROUTE,
    // The parser's literal title ("for a Strategy role with a Mumbai-based
    // MNC insurer.") is a sentence fragment lifted verbatim from the WhatsApp
    // forward — exactly the raw parser guess §9's human-confirmation step
    // exists to catch before a post publishes. This is what a poster would
    // actually have typed.
    title: 'Strategy Manager',
    posterRelationship: 'knows_contact',
    hiringContactName: 'Nikita',
    functionLabel: 'Strategy',
    postedAt: now - 10 * DAY_MS,
    lastConfirmedAt: now - 3 * DAY_MS,
  });

  const pSearchfirm = buildFixturePost({
    id: 'p_searchfirm',
    posterId: partho.id,
    companyId: null,
    confidentialDescriptor: 'healthcare services / wellness',
    raw: MSG_3_SEARCH_FIRM,
    title: 'CHIEF BUSINESS OFFICER',
    posterRelationship: 'forwarded',
    hiringContactName: null,
    functionLabel: 'Executive Search',
    postedAt: now - 20 * DAY_MS,
    lastConfirmedAt: now - 15 * DAY_MS,
  });

  const pFoodhak = buildFixturePost({
    id: 'p_foodhak',
    posterId: meera.id,
    companyId: 'c_foodhak',
    confidentialDescriptor: null,
    raw: MSG_4_NAMED_COMPANY,
    title: 'Brand Marketing Manager',
    posterRelationship: 'hiring_manager',
    hiringContactName: 'Meera Iyer',
    functionLabel: 'Marketing',
    postedAt: now - 2 * DAY_MS,
    lastConfirmedAt: now - 2 * DAY_MS,
  });

  const pAnveshan = buildFixturePost({
    id: 'p_anveshan',
    posterId: 'm_fill_100',
    companyId: 'c_anveshan',
    confidentialDescriptor: null,
    raw: MSG_5_CAREERS_EMAIL,
    title: 'Head of Operations',
    posterRelationship: 'forwarded',
    hiringContactName: null,
    functionLabel: 'Operations',
    postedAt: now - 40 * DAY_MS,
    // Stale: last confirmed 35 days ago, past the 30-day freshness window.
    lastConfirmedAt: now - 35 * DAY_MS,
  });

  // A sixth post, posted within the last 24 hours, so D17's WhatsApp digest
  // (which only ever looks at "today") has something to name (requirement 9).
  // Not one of §5.0's five — those are fixed at their own ages above — but run
  // through the same real parser, from a Nykaa employee sharing their own
  // company's opening.
  const pNykaa = buildFixturePost({
    id: 'p_nykaa',
    posterId: 'm_fill_25',
    companyId: 'c_nykaa',
    confidentialDescriptor: null,
    raw: 'Nykaa is hiring a Growth Marketing Associate!\n\nLocation: Mumbai\nExperience: 2-4 years\n\nApply here: https://nykaa.com/careers/growth-marketing-associate',
    title: 'Growth Marketing Associate',
    posterRelationship: 'internal_can_refer',
    hiringContactName: null,
    functionLabel: 'Marketing',
    postedAt: now - 3 * 60 * 60 * 1000,
    lastConfirmedAt: now - 3 * 60 * 60 * 1000,
  });

  const posts: JobPost[] = [pImpactco, pMncInsurer, pSearchfirm, pFoodhak, pAnveshan, pNykaa];

  // -- The visible duplicate (§5.1): another alum shares message 5's post ---

  const shares: PostShare[] = [
    { id: 'ps_1', jobPostId: pAnveshan.id, sharerId: 'm_fill_101', at: now - 32 * DAY_MS },
  ];

  // -- Applications (§8) -----------------------------------------------------

  const applications: PostApplication[] = [
    { id: 'app_1', jobPostId: pFoodhak.id, memberId: 'm_fill_150', appliedAt: now - 2 * DAY_MS, outcome: 'responded', outcomeAt: now - 1 * DAY_MS, promptedAt: null },
    { id: 'app_2', jobPostId: pFoodhak.id, memberId: 'm_fill_151', appliedAt: now - 2 * DAY_MS, outcome: 'interviewing', outcomeAt: now - 1 * DAY_MS, promptedAt: null },
    { id: 'app_3', jobPostId: pFoodhak.id, memberId: 'm_fill_152', appliedAt: now - 2 * DAY_MS, outcome: 'offer', outcomeAt: now, promptedAt: null },
    { id: 'app_4', jobPostId: pImpactco.id, memberId: 'm_fill_153', appliedAt: now - 5 * DAY_MS, outcome: 'no_response', outcomeAt: null, promptedAt: now - 1 * DAY_MS },
    { id: 'app_5', jobPostId: pImpactco.id, memberId: 'm_fill_154', appliedAt: now - 5 * DAY_MS, outcome: 'rejected', outcomeAt: now - 2 * DAY_MS, promptedAt: null },
    { id: 'app_6', jobPostId: pMncInsurer.id, memberId: 'm_fill_155', appliedAt: now - 8 * DAY_MS, outcome: 'unknown', outcomeAt: null, promptedAt: null },
    { id: 'app_7', jobPostId: pSearchfirm.id, memberId: 'm_fill_156', appliedAt: now - 18 * DAY_MS, outcome: 'rejected', outcomeAt: now - 10 * DAY_MS, promptedAt: null },
    // The stale Anveshan post: every applicant reads "outcomes unknown".
    { id: 'app_8', jobPostId: pAnveshan.id, memberId: 'm_fill_157', appliedAt: now - 38 * DAY_MS, outcome: 'unknown', outcomeAt: null, promptedAt: now - 20 * DAY_MS },
    { id: 'app_9', jobPostId: pAnveshan.id, memberId: 'm_fill_158', appliedAt: now - 37 * DAY_MS, outcome: 'unknown', outcomeAt: null, promptedAt: now - 20 * DAY_MS },
    { id: 'app_10', jobPostId: pAnveshan.id, memberId: 'm_fill_159', appliedAt: now - 36 * DAY_MS, outcome: 'unknown', outcomeAt: null, promptedAt: now - 20 * DAY_MS },
    // Ananya's own unanswered apply prompt, at least 14 days old (Task 22's
    // ruling): without this, the tracker's `application` row kind is
    // reachable from no persona at all, and §10's central claim — an overdue
    // referral request and an unanswered apply prompt render identically —
    // can never actually be seen.
    { id: 'app_11', jobPostId: pAnveshan.id, memberId: ananya.id, appliedAt: now - 16 * DAY_MS, outcome: 'unknown', outcomeAt: null, promptedAt: null },
  ];

  // -- Referral requests (§5.2 / §7.1), run through the real state machine --

  const reqA = buildRequestTimeline(
    {
      id: 'req_a_sent_overdue',
      seekerId: ananya.id,
      referrerId: rohit.id,
      companyId: 'c_impactco',
      jobPostId: pImpactco.id,
      roleUrl: null,
      roleTitle: pImpactco.title,
      resumeVersionId: 'res_ananya_v1',
      pitch: "I'd love an introduction — the People & Culture mandate lines up with my HR coursework.",
      createdAt: now - 10 * DAY_MS,
    },
    [],
  );

  const reqB = buildRequestTimeline(
    {
      id: 'req_b_accepted_overdue',
      seekerId: ananya.id,
      referrerId: meera.id,
      companyId: 'c_foodhak',
      jobPostId: pFoodhak.id,
      roleUrl: null,
      roleTitle: pFoodhak.title,
      resumeVersionId: 'res_ananya_v1',
      pitch: 'Would love to be considered for the Brand Marketing Manager opening.',
      createdAt: now - 20 * DAY_MS,
    },
    [{ to: 'accepted', role: 'referrer', at: now - 18 * DAY_MS, note: 'Meera agreed to refer.' }],
  );

  const reqC = buildRequestTimeline(
    {
      id: 'req_c_accepted_healthy',
      seekerId: 'm_fill_100',
      referrerId: 'm_fill_5',
      companyId: 'c_itc',
      jobPostId: null,
      roleUrl: 'https://itc.in/careers/12345',
      roleTitle: 'Category Manager',
      resumeVersionId: null,
      pitch: 'Referral request via the alumni network.',
      createdAt: now - 5 * DAY_MS,
    },
    [{ to: 'accepted', role: 'referrer', at: now - 4 * DAY_MS, note: 'Referrer accepted.' }],
  );

  const reqD = buildRequestTimeline(
    {
      id: 'req_d_submitted_overdue',
      seekerId: ananya.id,
      referrerId: 'm_fill_8',
      companyId: 'c_amazon',
      jobPostId: null,
      roleUrl: 'https://amazon.jobs/en/jobs/998877',
      roleTitle: 'Senior Product Manager',
      resumeVersionId: 'res_ananya_v1',
      pitch: 'Referral for the Senior PM opening in Bangalore.',
      createdAt: now - 30 * DAY_MS,
    },
    [
      { to: 'accepted', role: 'referrer', at: now - 28 * DAY_MS, note: 'Accepted — will submit shortly.' },
      { to: 'submitted', role: 'referrer', at: now - 27 * DAY_MS, note: 'Submitted to the hiring team.' },
    ],
  );

  const reqE = buildRequestTimeline(
    {
      id: 'req_e_submitted_healthy',
      seekerId: 'm_fill_101',
      referrerId: 'm_fill_18',
      companyId: 'c_icicibank',
      jobPostId: null,
      roleUrl: 'https://icicibank.com/careers/456',
      roleTitle: 'Relationship Manager',
      resumeVersionId: null,
      pitch: 'Referral request for the RM role.',
      createdAt: now - 6 * DAY_MS,
    },
    [
      { to: 'accepted', role: 'referrer', at: now - 5 * DAY_MS, note: 'Accepted.' },
      { to: 'submitted', role: 'referrer', at: now - 4 * DAY_MS, note: 'Submitted.' },
    ],
  );

  const reqF = buildRequestTimeline(
    {
      id: 'req_f_declined',
      seekerId: ananya.id,
      referrerId: 'm_fill_12',
      companyId: 'c_paytm',
      jobPostId: null,
      roleUrl: 'https://paytm.com/careers/321',
      roleTitle: 'Business Analyst',
      resumeVersionId: 'res_ananya_v1',
      pitch: 'Requesting a referral for the Business Analyst role.',
      createdAt: now - 15 * DAY_MS,
    },
    [{ to: 'declined', role: 'referrer', at: now - 14 * DAY_MS, note: 'No capacity this month.', declineReason: 'no_capacity' }],
  );

  const reqG = buildRequestTimeline(
    {
      id: 'req_g_offer',
      seekerId: 'm_fill_102',
      referrerId: 'm_fill_15',
      companyId: 'c_adityabirla',
      jobPostId: null,
      roleUrl: 'https://adityabirla.com/careers/789',
      roleTitle: 'Manager - Strategy',
      resumeVersionId: null,
      pitch: 'Referral for the Strategy Manager opening.',
      createdAt: now - 45 * DAY_MS,
    },
    [
      { to: 'accepted', role: 'referrer', at: now - 43 * DAY_MS, note: 'Accepted.' },
      { to: 'submitted', role: 'referrer', at: now - 42 * DAY_MS, note: 'Submitted.' },
      { to: 'interviewing', role: 'seeker', at: now - 30 * DAY_MS, note: 'Moved to interviews.' },
      { to: 'offer', role: 'seeker', at: now - 5 * DAY_MS, note: 'Offer extended!' },
    ],
  );

  const reqH = buildRequestTimeline(
    {
      id: 'req_h_interviewing',
      seekerId: 'm_fill_103',
      referrerId: 'm_fill_19',
      companyId: 'c_axisbank',
      jobPostId: null,
      roleUrl: 'https://axisbank.com/careers/654',
      roleTitle: 'Analytics Lead',
      resumeVersionId: null,
      pitch: 'Referral request for the Analytics Lead role.',
      createdAt: now - 25 * DAY_MS,
    },
    [
      { to: 'accepted', role: 'referrer', at: now - 23 * DAY_MS, note: 'Accepted.' },
      { to: 'submitted', role: 'referrer', at: now - 22 * DAY_MS, note: 'Submitted.' },
      { to: 'interviewing', role: 'seeker', at: now - 10 * DAY_MS, note: 'First round scheduled.' },
    ],
  );

  // §5.2 gives sent/accepted the SAME instant for "past due" and "auto-expired"
  // (seven days, fourteen days) — so a referrer-owed row that is both overdue
  // and still open after `runClock` is unreachable, and reqA/reqB above land on
  // `expired`/`expired_unsubmitted` once the clock runs (as intended: they are
  // the "what happens if nobody replies" examples). The three requests below
  // are what keep the tracker non-empty, with real owed-by-you rows, for the
  // referrer personas and for Karan, once the demo opens post-clock.

  const reqI = buildRequestTimeline(
    {
      id: 'req_i_rohit_owes',
      seekerId: 'm_fill_110',
      referrerId: rohit.id,
      companyId: 'c_impactco',
      jobPostId: pImpactco.id,
      roleUrl: null,
      roleTitle: pImpactco.title,
      resumeVersionId: null,
      pitch: "I'd love an introduction to the People & Culture opening.",
      createdAt: now - 3 * DAY_MS,
    },
    [],
  );

  const reqJ = buildRequestTimeline(
    {
      id: 'req_j_meera_owes',
      seekerId: 'm_fill_112',
      referrerId: meera.id,
      companyId: 'c_foodhak',
      jobPostId: pFoodhak.id,
      roleUrl: null,
      roleTitle: pFoodhak.title,
      resumeVersionId: null,
      pitch: 'Would love a referral for the Brand Marketing Manager role.',
      createdAt: now - 9 * DAY_MS,
    },
    [{ to: 'accepted', role: 'referrer', at: now - 7 * DAY_MS, note: 'Meera agreed to refer.' }],
  );

  const reqK = buildRequestTimeline(
    {
      id: 'req_k_karan_live',
      seekerId: karan.id,
      referrerId: 'm_fill_9',
      companyId: 'c_flipkart',
      jobPostId: null,
      roleUrl: 'https://flipkart.com/careers/234',
      roleTitle: 'Strategy Manager',
      resumeVersionId: null,
      // Karan is looking quietly, away from his own employer (§6/D6) — this
      // request is with an alum elsewhere, not at McKinsey.
      pitch: 'Referral request for the Strategy Manager opening.',
      createdAt: now - 2 * DAY_MS,
    },
    [],
  );

  const timelines = [reqA, reqB, reqC, reqD, reqE, reqF, reqG, reqH, reqI, reqJ, reqK];
  const requests: ReferralRequest[] = timelines.map((t) => t.request);
  const requestEvents: RequestEvent[] = timelines.flatMap((t) => t.events);

  // -- Resumes ----------------------------------------------------------------

  const resumes: ResumeVersion[] = [
    { id: 'res_ananya_v1', memberId: ananya.id, filename: 'Ananya_Rao_Resume.pdf', uploadedAt: now - 40 * DAY_MS },
  ];

  // -- Reports ------------------------------------------------------------------

  const reports: Report[] = [
    { id: 'rep_1', reporterId: 'm_fill_120', targetType: 'post', targetId: pSearchfirm.id, reason: 'Recruiter is asking for an upfront fee.', at: now - 12 * DAY_MS, resolvedAt: null },
    { id: 'rep_2', reporterId: 'm_fill_121', targetType: 'member', targetId: 'm_fill_185', reason: 'Profile details do not match LinkedIn.', at: now - 9 * DAY_MS, resolvedAt: now - 8 * DAY_MS },
  ];

  return {
    version: SCHEMA_VERSION,
    school,
    members,
    companies: ALL_COMPANIES,
    posts,
    shares,
    applications,
    requests,
    requestEvents,
    cases,
    resumes,
    vouches,
    reports,
    currentMemberId: ananya.id,
  };
}
