/**
 * Render smoke test + architectural guards (Task 25).
 *
 * A passing typecheck does not catch a bad store call, a null company on a
 * confidential post, or a member with no employment — this does. Every
 * screen-level component under `src/ui/` is rendered to a string, through
 * Vite's SSR loader, against the real seeded store (the same `buildSeed`
 * demo data the dev server shows). This asserts that each screen renders at
 * all; it does not assert on markup, except where noted below.
 *
 * Three things beyond "it rendered":
 *
 *   1. The `getState()` guard (and its two neighbours). Grepped statically,
 *      before Vite is even started — see `checkArchitecturalGuard` below.
 *   2. The D2 gate: an unverified viewer's board carries no member data.
 *   3. Field scoping: a member read never exposes another member's
 *      `privacy`, `googleSub`, `caps` or real `email`.
 */
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let failed = 0;

function ok(label, detail = '') {
  console.log(`  ok   ${label.padEnd(28)} ${detail}`);
}
function fail(label, detail) {
  failed += 1;
  console.log(`  FAIL ${label}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Guard: the `src/ui/` boundary (checked statically, no server needed).
//
// `src/data/store.ts` documents `getState()` as "TEST-ONLY" and explains why:
// it is the one function in that file that answers without asking who is
// looking, bypassing every viewer scope at once — `getState().members` hands
// back the blocked-company list `toPublicMember` exists to strip, and
// `getState().requests` hands back every private 1:1 request in the network.
// A screen that needs different data needs a new store function, not this.
// `localStorage` and `core/privacy.ts` are the same shape of hole: the first
// is persistence, which is `store.ts`'s job alone; the second is the privacy
// filter, which only means anything applied consistently, inside the store's
// read functions — not re-implemented ad hoc in a component.
// ---------------------------------------------------------------------------
function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listSourceFiles(p));
    else if (['.ts', '.tsx'].includes(extname(p))) out.push(p);
  }
  return out;
}

function checkArchitecturalGuard() {
  const uiDir = join(ROOT, 'src', 'ui');
  const files = listSourceFiles(uiDir);
  const violations = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1);

    if (/\bgetState\s*\(/.test(text) || /(?:^|[{,\s])getState(?:\s*,|\s*})/.test(text)) {
      violations.push(
        `${rel} calls or imports store.getState(). That function is TEST-ONLY (see src/data/store.ts) — ` +
          `it answers without asking who is looking, so it bypasses every viewer scope at once: it would hand ` +
          `this component the blocked-company list toPublicMember exists to strip, or every private 1:1 request ` +
          `in the network, not just the viewer's own. A screen that needs different data needs a new store ` +
          `function that takes the viewer into account — never this one.`,
      );
    }
    if (/\blocalStorage\b/.test(text)) {
      violations.push(
        `${rel} references localStorage directly. Persistence is src/data/store.ts's job alone — a component ` +
          `that reads or writes storage itself steps around the privacy filter and the commit/notify contract ` +
          `every other write in this app goes through.`,
      );
    }
    if (/from\s+['"][^'"]*core\/privacy(?:\.ts)?['"]/.test(text)) {
      violations.push(
        `${rel} imports core/privacy.ts directly. The privacy filter only means anything if it is applied the ` +
          `same way on every read — that happens once, inside src/data/store.ts's read functions. A UI module ` +
          `importing the filter itself could apply it inconsistently, or forget to, on some path the store ` +
          `never sees.`,
      );
    }
  }

  if (violations.length) {
    for (const v of violations) fail('architecture guard', v);
  } else {
    ok(
      'architecture guard',
      'no src/ui/ file calls getState(), touches localStorage, or imports core/privacy.ts',
    );
  }
}

checkArchitecturalGuard();

// ---------------------------------------------------------------------------
// Render smoke, against the real seeded store.
// ---------------------------------------------------------------------------
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.location = new URL('http://localhost:5174/');

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const load = (p) => vite.ssrLoadModule(p);

const store = await load('/src/data/store.ts');
const now = Date.now();
store.load({ now, runClockOnLoad: true });

const noop = () => {};
const render = (Component, props) => renderToString(h(Component, props));

function renderScreen(label, mod, name, props) {
  try {
    const Component = mod[name];
    if (!Component) throw new Error(`${name} is not exported from this module`);
    const html = render(Component, props);
    ok(label, `${String(html.length).padStart(6)} chars`);
    return html;
  } catch (err) {
    fail(label, err.message);
    return null;
  }
}

// Pull real ids out of the seeded store — never invented — the same way any
// other caller of the store would: through its public, viewer-scoped reads.
store.setCurrentMember('m_ananya'); // the seed's default viewer; verified, Tier A.

const posts = store.listPosts(now);
const namedCompanyPost = posts.find((p) => p.companyId !== null) ?? posts[0];
const companies = store.listCompanies();
const companyId = namedCompanyPost?.companyId ?? companies[0]?.id;

const requests = store.listRequests();
const viewer = store.getCurrentMember();
const myRequest = requests.find((r) => r.seekerId === viewer.id) ?? requests[0];

const alumniHere = companyId ? store.alumniAt(companyId).find((m) => m.id !== viewer.id) : null;

console.log('\nRendering every screen-level component under src/ui/:\n');

const AppMod = await load('/src/ui/App.tsx');
renderScreen('App', AppMod, 'App', {});

const BoardMod = await load('/src/ui/Board.tsx');
renderScreen('Board', BoardMod, 'Board', { now, onOpenPost: noop });

const TrackerMod = await load('/src/ui/Tracker.tsx');
renderScreen('Tracker', TrackerMod, 'Tracker', { now, onOpenRequest: noop, onOpenPost: noop });

const DirectoryMod = await load('/src/ui/Directory.tsx');
renderScreen('Directory', DirectoryMod, 'Directory', { now, onOpenCompany: noop, onRequestReferral: noop });

const CompanyPageMod = await load('/src/ui/CompanyPage.tsx');
if (companyId) {
  renderScreen('CompanyPage', CompanyPageMod, 'CompanyPage', {
    companyId,
    now,
    onBack: noop,
    onRequestReferral: noop,
  });
} else {
  fail('CompanyPage', 'no company found in the seeded store to render against');
}

const RequestsMod = await load('/src/ui/Requests.tsx');
renderScreen('Requests', RequestsMod, 'Requests', { now });

const ProfileMod = await load('/src/ui/Profile.tsx');
renderScreen('Profile', ProfileMod, 'Profile', {});

const PostDetailMod = await load('/src/ui/PostDetail.tsx');
if (namedCompanyPost) {
  renderScreen('PostDetail', PostDetailMod, 'PostDetail', {
    postId: namedCompanyPost.id,
    now,
    onClose: noop,
    onRequestReferral: noop,
  });
} else {
  fail('PostDetail', 'no post found in the seeded store to render against');
}

const RequestDetailMod = await load('/src/ui/RequestDetail.tsx');
if (myRequest) {
  renderScreen('RequestDetail', RequestDetailMod, 'RequestDetail', {
    requestId: myRequest.id,
    now,
    onClose: noop,
  });
} else {
  fail('RequestDetail', 'no request found in the seeded store to render against');
}

const PostCardMod = await load('/src/ui/PostCard.tsx');
if (posts[0]) {
  renderScreen('PostCard', PostCardMod, 'PostCard', { post: posts[0], now, onOpen: noop });
} else {
  fail('PostCard', 'no post found in the seeded store to render against');
}

const PostComposerMod = await load('/src/ui/PostComposer.tsx');
renderScreen('PostComposer', PostComposerMod, 'PostComposer', { open: true, onClose: noop, onPublished: noop });

const RequestComposerMod = await load('/src/ui/RequestComposer.tsx');
if (alumniHere) {
  // Note: `RequestComposer` seeds its form from a `useEffect`, which
  // `renderToString` never runs (SSR has no effect phase). The component
  // therefore renders `null` on the very first pass — this still exercises
  // the module's import graph and its "nothing open" branch without
  // throwing, which is what this smoke test asserts. It is not a rendering
  // of the filled-in form; the Task 25 walkthrough covers that in a real
  // browser instead (see the task report).
  renderScreen('RequestComposer', RequestComposerMod, 'RequestComposer', {
    open: true,
    prefill: { referrerId: alumniHere.id, companyId, roleTitle: 'Smoke test role', jobPostId: null, roleUrl: null },
    onClose: noop,
    onSent: noop,
  });
} else {
  fail('RequestComposer', 'no open-to-referring alumnus found at the chosen company');
}

const ShellMod = await load('/src/ui/Shell.tsx');
renderScreen('Shell', ShellMod, 'Shell', {
  nav: [{ id: 'board', label: 'Board', badge: 2 }],
  active: 'board',
  onNavigate: noop,
  children: h('div', null, 'smoke'),
});

const VerificationGateMod = await load('/src/ui/VerificationGate.tsx');
renderScreen('VerificationGate', VerificationGateMod, 'VerificationGate', {
  children: h('div', null, 'gated content'),
});

// CapacityControls and Admin both read `getCurrentMember()` directly (their
// own caps; the admin queue), so they are rendered once as a referrer and
// once as the admin persona, rather than as the default seeker viewer.
store.setCurrentMember('m_meera');
const CapacityControlsMod = await load('/src/ui/CapacityControls.tsx');
renderScreen('CapacityControls', CapacityControlsMod, 'CapacityControls', {});

store.setCurrentMember('m_admin');
const AdminMod = await load('/src/ui/Admin.tsx');
renderScreen('Admin', AdminMod, 'Admin', { now });

store.setCurrentMember('m_ananya');

console.log(
  '\n  note: primitives.tsx exports a library of building blocks (Button, Chip, Avatar,\n' +
    '        Modal, Field, Input, Select, Card, EmptyState, Meter, Tabs) rather than a\n' +
    '        single screen-level component — it has no default render target of its own,\n' +
    '        and every screen rendered above already exercises it. useStore.ts exports\n' +
    '        two hooks, not a component, for the same reason. Neither is skipped by\n' +
    '        omission — both are read; there is simply nothing named in either file that\n' +
    '        this test could call renderToString on.',
);

// ---------------------------------------------------------------------------
// Assertion 1 of 2: D2, "an unverified account can see nothing." Board asked
// to render for an unverified/pending viewer must carry none of the verified
// membership by name.
// ---------------------------------------------------------------------------
console.log('\nD2 gate and field-scoping assertions:\n');

try {
  const pending = store.listPersonas().find((p) => p.status === 'pending');
  if (!pending) throw new Error('no pending persona in the seeded store to test the gate against');
  store.setCurrentMember(pending.id);

  const html = render(BoardMod.Board, { now, onOpenPost: noop });
  const verifiedNames = store
    .listPersonas()
    .filter((p) => p.status === 'verified')
    .slice(0, 40)
    .map((p) => p.name);
  const leaked = verifiedNames.filter((n) => html.includes(n));
  if (leaked.length) {
    fail('D2 gate', `unverified viewer's Board render contains: ${leaked.join(', ')}`);
  } else {
    ok('D2 gate', `unverified viewer (${pending.id}) sees no member data on the board`);
  }
} catch (err) {
  fail('D2 gate', err.message);
} finally {
  store.setCurrentMember('m_ananya');
}

// ---------------------------------------------------------------------------
// Assertion 2 of 2: field scoping. A member read must never expose another
// member's `privacy`, `googleSub` or `caps`, and must never expose their real
// email address either. This was a real defect caught mid-build (Task 24) —
// this is its regression test, run every time `npm run verify` runs.
// ---------------------------------------------------------------------------
try {
  const karan = store.listMembers().find((m) => m.name === 'Karan Shah');
  if (!karan) throw new Error('Karan Shah not found in the seeded, viewer-scoped member list');

  const publicKaran = store.getMember(karan.id);
  if (!publicKaran) throw new Error('getMember(karan.id) returned null for a member the viewer can see');

  const problems = [];
  if ('privacy' in publicKaran) problems.push('privacy is present (should be stripped entirely)');
  if ('googleSub' in publicKaran) problems.push('googleSub is present (should be stripped entirely)');
  if ('caps' in publicKaran) problems.push('caps is present (should be stripped entirely)');
  if (publicKaran.email !== null) problems.push(`email is "${publicKaran.email}" (should be null for a non-self read)`);

  if (problems.length) {
    fail('field scoping', `getMember(karan.id) as a non-blocked other member: ${problems.join('; ')}`);
  } else {
    ok('field scoping', "getMember(karan.id) hides privacy/googleSub/caps and nulls email for a non-self viewer");
  }
} catch (err) {
  fail('field scoping', err.message);
}

await vite.close();

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
