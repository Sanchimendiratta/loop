/**
 * Render smoke test + architectural guards.
 *
 * A passing typecheck does not catch a bad store call, a null company on a
 * confidential post, or a member with no employment — this does. Every
 * screen-level component under `src/ui/` is rendered to a string, through
 * Vite's SSR loader, against the real seeded store (the same `buildSeed`
 * demo data the dev server shows). This asserts that each screen renders at
 * all, and that its markup contains no `NaN`, `undefined` or
 * `[object Object]` — "it produced characters" is not the same claim as "it
 * produced truth", and a missing prop (a `now` nobody passed, an id that
 * doesn't resolve) tends to show up as exactly one of those three strings.
 *
 * Four things beyond "it rendered, and it isn't lying":
 *
 *   1. The `getState()` guard (and its two neighbours). Grepped statically,
 *      before Vite is even started — see `checkArchitecturalGuard` below.
 *   2. The D2 gate: a pending viewer's `App` render carries no post, company,
 *      apply-route or applicant data — calibrated first against a verified
 *      viewer, so the detector is proven able to fail.
 *   3. Field scoping: `applicantsFor(postId)` returns rows to that post's
 *      poster and `[]` to every other member, admin included — this is the
 *      "third assertion" v1.3 ran as a render; here it runs as a direct call
 *      against the store, because the subject worth pinning is the store's
 *      rule, not a screen's markup (`test/store.test.ts` also pins it).
 *   4. The orphan check: any module under `src/` that nothing else in `src/`
 *      imports fails the build — the guard against pruning a branch and
 *      leaving vestiges (design doc §2). A narrower, screen-shaped cousin of
 *      the same idea runs right after the render loop: every `src/ui/*.tsx`
 *      file must be either rendered above or named, with a reason, on the
 *      exempt list — because a module only `App.tsx` imports is not an
 *      orphan, but it can still go completely unrendered.
 */
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
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

// ---------------------------------------------------------------------------
// Assertion 1 of 4: the `src/ui/` boundary guard (checked statically, no
// server needed).
//
// `src/data/store.ts` documents `getState()` as "TEST-ONLY" and explains why:
// it is the one function in that file that answers without asking who is
// looking, bypassing all three of Lite's rules at once — `getState()
// .applications` hands back every applicant on every post, which rule 2 keeps
// to exactly one person, and it answers for a pending viewer that rule 1 says
// may read nothing. A screen that needs different data needs a new store
// function, not this. `localStorage` and `core/privacy.ts` are the same shape
// of hole: the first is persistence, which is `store.ts`'s job alone; the
// second is a module Lite deleted — D2 now lives in `store.viewerOrNull()`,
// and a UI module reimporting a privacy filter would be applying it ad hoc,
// outside every read that is supposed to carry it.
// ---------------------------------------------------------------------------
function checkArchitecturalGuard() {
  const uiDir = join(ROOT, 'src', 'ui');
  const files = listSourceFiles(uiDir);
  const violations = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // `ROOT` is a directory URL turned back into a path, so it already ends in
    // a trailing slash — slicing at `ROOT.length` (not `+ 1`) is what leaves
    // "src/ui/App.tsx" rather than a leading character eaten off it.
    const rel = file.slice(ROOT.length);

    if (/\bgetState\s*\(/.test(text) || /(?:^|[{,\s])getState(?:\s*,|\s*})/.test(text)) {
      violations.push(
        `${rel} calls or imports store.getState(). That function is TEST-ONLY (see src/data/store.ts) — ` +
          `it answers without asking who is looking, so it bypasses all three of Lite's rules at once: it ` +
          `would hand this component every applicant on every post, which rule 2 keeps to exactly one ` +
          `person, and it would answer for a pending viewer that rule 1 says may read nothing. A screen ` +
          `that needs different data needs a new store function that takes the viewer into account — ` +
          `never this one.`,
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
        `${rel} imports core/privacy.ts directly. Lite deleted that module — D2 lives in ` +
          `store.viewerOrNull() now, and every exported read begins with it. A privacy filter only means ` +
          `anything if it is applied the same way on every read; a UI module importing one could apply it ` +
          `inconsistently, or forget to, on some path the store never sees.`,
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
// Assertion 4 of 4 (part 1 — the module-level orphan check): any module
// under `src/` that nothing else in `src/` imports. Static, like the guard
// above: every `.ts`/`.tsx` file's `import`/`export ... from`/`import(...)`
// specifiers are pulled with a regex, relative ones resolved against the
// importing file's directory, and collected into one "imported" set. A file
// under `src/` absent from that set is an orphan — a vestige pruning a
// branch leaves behind (design doc §2's mechanical half).
//
// Two named exceptions, because nothing in `src/` is expected to import
// either on purpose:
//   - `src/main.tsx` — the Vite entry point, wired from `index.html`, not
//     from another module.
//   - `src/sw.ts` — the service worker, registered by URL through
//     `?worker&url` (see `main.tsx`), a string Vite's worker plugin resolves
//     specially rather than a specifier this regex should follow.
// ---------------------------------------------------------------------------
const ORPHAN_CHECK_EXEMPT = new Set([join(ROOT, 'src', 'main.tsx'), join(ROOT, 'src', 'sw.ts')]);

const IMPORT_SPECIFIER_PATTERNS = [
  /\bimport\s+(?:type\s+)?(?:[^'";]+?\bfrom\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:[^'";]+?\bfrom\s+)?['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function findImportSpecifiers(text) {
  const specifiers = [];
  for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
    for (const m of text.matchAll(pattern)) specifiers.push(m[1]);
  }
  return specifiers;
}

function checkOrphans() {
  const files = listSourceFiles(join(ROOT, 'src'));
  const imported = new Set();

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const dir = dirname(file);
    for (const spec of findImportSpecifiers(text)) {
      if (!spec.startsWith('.')) continue; // a package import can't name a src/ orphan candidate
      const bare = spec.split('?')[0]; // `./sw.ts?worker&url` -> `./sw.ts`
      imported.add(join(dir, bare));
    }
  }

  const orphans = files.filter((f) => !ORPHAN_CHECK_EXEMPT.has(f) && !imported.has(f));
  if (orphans.length) {
    for (const o of orphans) {
      fail(
        'orphan check',
        `${o.slice(ROOT.length)} is never imported by any other file under src/ — either a vestige left ` +
          `behind by pruning, or a module that still needs wiring in.`,
      );
    }
  } else {
    ok('orphan check', 'every file under src/ (besides main.tsx and sw.ts) is imported by something else in src/');
  }
}

checkOrphans();

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
// `reset`, not `load`: this run never touches a prior session, so the point
// is a byte-identical, deterministic seed every time, not "reuse whatever
// localStorage happens to hold" — `load`'s job, and the right one for
// `main.tsx`, is exactly the thing a smoke run should not depend on.
store.reset(now);

const noop = () => {};
const render = (Component, props) => renderToString(h(Component, props));

/** Rendered markup that lies about the work it did — see the module docblock. */
const JUNK_PATTERNS = [
  { name: 'NaN', pattern: /\bNaN\b/ },
  { name: 'undefined', pattern: /\bundefined\b/ },
  { name: '[object Object]', pattern: /\[object Object\]/ },
];

function assertNoJunkMarkup(label, html) {
  const hit = JUNK_PATTERNS.find(({ pattern }) => pattern.test(html));
  if (hit) {
    fail(
      `${label} markup`,
      `rendered output contains "${hit.name}" — a screen that renders is not the same as a screen that ` +
        `renders something true (a likely cause: a prop the caller here forgot to pass, e.g. \`now\`).`,
    );
  } else {
    ok(`${label} markup`, 'no NaN, undefined, or [object Object]');
  }
}

/** Every `src/ui/*.tsx` filename this script has rendered — fed to `checkUiComponentCoverage` below. */
const renderedUiFiles = new Set();

function renderScreen(fileName, label, mod, name, props) {
  renderedUiFiles.add(fileName);
  try {
    const Component = mod[name];
    if (!Component) throw new Error(`${name} is not exported from this module`);
    const html = render(Component, props);
    ok(label, `${String(html.length).padStart(6)} chars`);
    assertNoJunkMarkup(label, html);
    return html;
  } catch (err) {
    fail(label, err.message);
    return null;
  }
}

// Pull real ids out of the seeded store — never invented — the same way any
// other caller of the store would: through its public, viewer-scoped reads.
store.setCurrentMember('m_ananya'); // the seed's default viewer; verified, Tier A, owns no posts.

console.log('\nRendering every screen-level component under src/ui/:\n');

const AppMod = await load('/src/ui/App.tsx');
renderScreen('App.tsx', 'App', AppMod, 'App', {});

const BoardMod = await load('/src/ui/Board.tsx');
renderScreen('Board.tsx', 'Board', BoardMod, 'Board', { now });

const PostComposerMod = await load('/src/ui/PostComposer.tsx');
renderScreen('PostComposer.tsx', 'PostComposer', PostComposerMod, 'PostComposer', {
  open: true,
  onClose: noop,
  onPublished: noop,
});

const ShellMod = await load('/src/ui/Shell.tsx');
renderScreen('Shell.tsx', 'Shell', ShellMod, 'Shell', {
  nav: [{ id: 'board', label: 'Board', badge: 2 }],
  active: 'board',
  onNavigate: noop,
  now,
  children: h('div', null, 'smoke'),
});

const VerificationGateMod = await load('/src/ui/VerificationGate.tsx');
renderScreen('VerificationGate.tsx', 'VerificationGate', VerificationGateMod, 'VerificationGate', {
  children: h('div', null, 'gated content'),
});

const LoginMod = await load('/src/ui/Login.tsx');
renderScreen('Login.tsx', 'Login', LoginMod, 'Login', {});

const MyApplicationsMod = await load('/src/ui/MyApplications.tsx');
renderScreen('MyApplications.tsx', 'MyApplications', MyApplicationsMod, 'MyApplications', {
  now,
  onBrowseBoard: noop,
});

// `m_meera` posted `p_foodhak`, which carries four seeded applicants — the
// default viewer (`m_ananya`) owns no posts, so rendering `MyPosts` as her
// would only ever exercise the empty state, not the applicant-expansion
// branch this screen exists for.
store.setCurrentMember('m_meera');
const MyPostsMod = await load('/src/ui/MyPosts.tsx');
renderScreen('MyPosts.tsx', 'MyPosts', MyPostsMod, 'MyPosts', { now, onPostRole: noop });
store.setCurrentMember('m_ananya');

// Admin reads `getCurrentMember()` directly (the admin queue), so it is
// rendered as the admin persona rather than as the default seeker viewer.
store.setCurrentMember('m_admin');
const AdminMod = await load('/src/ui/Admin.tsx');
renderScreen('Admin.tsx', 'Admin', AdminMod, 'Admin', { now });

store.setCurrentMember('m_ananya');

// ---------------------------------------------------------------------------
// Assertion 4 of 4 (part 2 — the screen-coverage check): every `src/ui/*.tsx`
// file is either rendered above or named, with why, on this list. The module
// orphan check above cannot catch a screen with zero automated coverage: a
// component only `App.tsx` imports is not an orphan by that check's
// definition, but it can still have never once been handed to
// `renderToString`. This is the check that catches that gap specifically —
// it is what would have failed the build the moment `MyApplications.tsx`,
// `MyPosts.tsx` and `Login.tsx` existed but were never rendered.
// ---------------------------------------------------------------------------
const UI_COMPONENT_COVERAGE_EXEMPT = {
  'Bell.tsx':
    'renders inside Shell, not as a screen of its own — the Shell render above already mounts it and exercises its markup.',
  'primitives.tsx':
    'exports a library of building blocks (Button, Chip, Avatar, Modal, Field, Input, Select, Card, EmptyState, ' +
    'Meter, Tabs) rather than a single screen-level component — it has no default render target of its own, and ' +
    'every screen rendered above already exercises it.',
};

function checkUiComponentCoverage() {
  const uiDir = join(ROOT, 'src', 'ui');
  const tsxFiles = readdirSync(uiDir).filter((f) => f.endsWith('.tsx'));
  const missing = tsxFiles.filter((f) => !renderedUiFiles.has(f) && !(f in UI_COMPONENT_COVERAGE_EXEMPT));

  if (missing.length) {
    for (const m of missing) {
      fail(
        'ui component coverage',
        `src/ui/${m} is neither rendered by this script nor on the exempt list above — add a renderScreen() ` +
          `call for it, or an exempt entry that names why one is not needed.`,
      );
    }
  } else {
    ok(
      'ui component coverage',
      `every src/ui/*.tsx file is rendered above or exempt-with-a-reason (${Object.keys(UI_COMPONENT_COVERAGE_EXEMPT).join(', ')})`,
    );
  }
}

checkUiComponentCoverage();

console.log(
  '\n  note: useStore.ts exports two hooks, not a component, so it has nothing named in it this test\n' +
    '        could call renderToString on; it is read (by every screen above that calls them), not skipped\n' +
    '        by omission. It is a `.ts` file, not `.tsx`, so the coverage check above does not expect an\n' +
    '        entry for it the way it does for primitives.tsx.',
);

// ---------------------------------------------------------------------------
// Assertion 3 of 4: field scoping — rule 2, "applicant details reach exactly
// one person," pinned directly against the store rather than against a
// screen's markup. `p_foodhak` (posted by `m_meera`) carries four seeded
// applicants, so this is not a vacuous check: three of the "other" members it
// tests against (`m_rohit`, `m_partho`, `m_karan`) are themselves applicants
// to this very post, and still see nothing when they are not its poster.
// `m_admin` is included in the same loop, on purpose and with no special
// case — rule 2 has no admin exception; `applicantsFor`'s docblock says so.
// ---------------------------------------------------------------------------
console.log('\nField scoping assertion (applicantsFor):\n');

try {
  const postId = 'p_foodhak';
  const ownerId = 'm_meera';

  store.setCurrentMember(ownerId);
  const ownerRows = store.applicantsFor(postId);
  if (ownerRows.length === 0) {
    throw new Error(`expected ${ownerId} (the poster of ${postId}) to see applicant rows — got none; did the seed change?`);
  }

  const others = store.listPersonas().filter((p) => p.id !== ownerId);
  if (!others.some((p) => p.id === 'm_admin')) {
    throw new Error("no 'm_admin' persona in the seeded store — the admin half of this assertion has nothing to run against");
  }

  for (const other of others) {
    store.setCurrentMember(other.id);
    const rows = store.applicantsFor(postId);
    if (rows.length !== 0) {
      const who = other.id === 'm_admin' ? `${other.id} (admin)` : `${other.id} (${other.status})`;
      throw new Error(`${who} saw ${rows.length} applicant row(s) for a post they did not post — field scoping leak`);
    }
  }

  ok(
    'field scoping',
    `applicantsFor('${postId}') returns ${ownerRows.length} row(s) to its poster (${ownerId}) and [] to the ` +
      `other ${others.length} member(s), admin included`,
  );
} catch (err) {
  fail('field scoping', err.message);
} finally {
  store.setCurrentMember('m_ananya');
}

// ---------------------------------------------------------------------------
// Assertion 2 of 4: D2, "an unverified account can see nothing."
//
// Pointed at `App`, not `Board`. Board was the wrong subject: it renders member
// and post data only from `listPosts`, which returns [] for a gated viewer, so
// a grep over its markup could never fail and reported coverage it did not
// have. `App` is the real composition — persona switcher, nav, badge counts and
// whatever the gate lets through — so it is where a leak would actually show.
//
// One ungated surface is excluded on purpose: the persona `<select>`. It stands
// in for Google's account chooser and sits ABOVE the gate, so a blocked member
// is not stranded with no way back to a verified account; `listPersonas` is
// deliberately narrow (a name and a gate state, nothing else). Everything
// outside that element must be empty of network data.
//
// The check begins with a positive control: the same detector run against a
// VERIFIED viewer must find post data. Without it, a detector broken by an
// escaping change or a markup change would pass silently — which is the exact
// failure this assertion replaces.
//
// The secret list is built from every post and every application in the
// store, keyed by value rather than by whose row it came from — which means
// it can, by coincidence, contain a string that is ALSO a value on the
// current viewer's own record (e.g. one member's "known by" field naming
// another member who happens to be an applicant elsewhere). A viewer's own
// name, batch, programme, LinkedIn URL and "known by" are theirs to see —
// Lite §3 requires the Pending screen to show exactly that, as "the evidence
// they submitted" — so `ownFieldValues` below is subtracted from the secret
// list before either check runs. This narrows what counts as a leak; it must
// not narrow it to nothing, which is why the positive control still has to
// fire afterwards.
// ---------------------------------------------------------------------------
console.log('\nD2 gate assertion:\n');

/** React escapes text children; a raw-string grep would miss "People & Culture". */
const escapeHtml = (v) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const containsValue = (html, v) => html.includes(v) || html.includes(escapeHtml(v));

/**
 * The markup with the persona switcher cut out. Throws rather than returning
 * the whole document if the switcher is missing, so a markup change cannot
 * turn this into a weaker assertion without anyone noticing.
 */
function outsideThePersonaSwitcher(html) {
  const start = html.indexOf('<select');
  const end = html.indexOf('</select>');
  if (start === -1 || end === -1) {
    throw new Error('App rendered no persona <select>; the ungated-surface exclusion would be silently wrong');
  }
  return html.slice(0, start) + html.slice(end + '</select>'.length);
}

try {
  // Read unscoped, through the test-only escape hatch, so the assertion knows
  // exactly what a leak would look like.
  const st = store.getState();
  const secrets = [];
  for (const p of st.posts) {
    secrets.push(['post title', p.title]);
    if (p.companyName) secrets.push(['company name', p.companyName]);
    if (p.confidentialDescriptor) secrets.push(['confidential descriptor', p.confidentialDescriptor]);
    if (p.applyValue) secrets.push(['apply route', p.applyValue]);
  }
  for (const a of st.applications) {
    const m = st.members.find((x) => x.id === a.memberId);
    if (m) secrets.push(['applicant name', m.name]);
  }

  /** The current viewer's own submitted evidence — theirs to see, never a leak, however it collides with the secret list above. */
  function ownFieldValues(memberId) {
    const m = st.members.find((x) => x.id === memberId);
    if (!m) return new Set();
    return new Set([m.name, String(m.batch), m.programme, m.linkedinUrl, m.knownBy].filter(Boolean));
  }

  // Positive control.
  const verified = store.listPersonas().find((p) => p.status === 'verified');
  if (!verified) throw new Error('no verified persona in the seeded store to calibrate the detector against');
  store.setCurrentMember(verified.id);
  const visible = outsideThePersonaSwitcher(render(AppMod.App, {}));
  const verifiedOwn = ownFieldValues(verified.id);
  const found = secrets.filter(([, v]) => containsValue(visible, v) && !verifiedOwn.has(v));
  if (!found.length) {
    fail('D2 gate', 'the detector found no post data even for a VERIFIED viewer — it cannot fail, so it proves nothing');
  } else {
    ok('D2 detector', `${found.length} data point(s) visible to a verified viewer — the grep works`);

    // The assertion itself.
    const pending = store.listPersonas().find((p) => p.status === 'pending');
    if (!pending) throw new Error('no pending persona in the seeded store to test the gate against');
    store.setCurrentMember(pending.id);

    const gated = outsideThePersonaSwitcher(render(AppMod.App, {}));
    const pendingOwn = ownFieldValues(pending.id);
    const leaked = secrets.filter(([, v]) => containsValue(gated, v) && !pendingOwn.has(v));
    if (leaked.length) {
      fail('D2 gate', `pending viewer's App render leaks ${leaked.map(([k, v]) => `${k} "${v}"`).join(', ')}`);
    } else {
      ok(
        'D2 gate',
        `pending viewer (${pending.id}) sees none of ${secrets.length} network data points beyond their own submitted evidence`,
      );
    }
  }
} catch (err) {
  fail('D2 gate', err.message);
} finally {
  store.setCurrentMember('m_ananya');
}

await vite.close();

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
