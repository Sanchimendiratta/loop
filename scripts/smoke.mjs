/**
 * Render smoke test + architectural guards.
 *
 * A passing typecheck does not catch a bad store call, a null company on a
 * confidential post, or a member with no employment — this does. Every
 * screen-level component under `src/ui/` is rendered to a string, through
 * Vite's SSR loader, against the real seeded store (the same `buildSeed`
 * demo data the dev server shows). This asserts that each screen renders at
 * all; it does not assert on markup, except where noted below.
 *
 * Two things beyond "it rendered" (a third — field scoping on a per-member
 * read — lost its subject when the directory was pruned; what replaced it is
 * the store's rule 2, "applicant details reach exactly one person", which is
 * pinned by `test/store.test.ts` rather than by a render):
 *
 *   1. The `getState()` guard (and its two neighbours). Grepped statically,
 *      before Vite is even started — see `checkArchitecturalGuard` below.
 *   2. The D2 gate: a pending viewer's `App` render carries no post, company,
 *      apply-route or applicant data — calibrated first against a verified
 *      viewer, so the detector is proven able to fail.
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
// Assertion 1 of 3: the `src/ui/` boundary guard (checked statically, no
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
store.load({ now });

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

console.log('\nRendering every screen-level component under src/ui/:\n');

const AppMod = await load('/src/ui/App.tsx');
renderScreen('App', AppMod, 'App', {});

const BoardMod = await load('/src/ui/Board.tsx');
renderScreen('Board', BoardMod, 'Board', { now });

const PostComposerMod = await load('/src/ui/PostComposer.tsx');
renderScreen('PostComposer', PostComposerMod, 'PostComposer', { open: true, onClose: noop, onPublished: noop });

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

// Admin reads `getCurrentMember()` directly (the admin queue), so it is
// rendered as the admin persona rather than as the default seeker viewer.
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
// Assertion 2 of 2: D2, "an unverified account can see nothing."
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
