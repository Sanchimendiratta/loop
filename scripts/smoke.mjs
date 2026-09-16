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
 *   2. The D2 gate: an unverified viewer's board carries no member data.
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
renderScreen('Board', BoardMod, 'Board', { now, onOpenPost: noop });

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
// Assertion 2 of 2: D2, "an unverified account can see nothing." Board asked
// to render for an unverified/pending viewer must carry none of the verified
// membership by name.
//
// Lite has no directory, and `getMember`/`listMembers` went with it, so the
// old field-scoping assertion here has no subject left. Its replacement is
// rule 2 — applicant details reach only the poster — which `test/store.test.ts`
// pins directly against the store rather than through a rendered screen.
// ---------------------------------------------------------------------------
console.log('\nD2 gate assertion:\n');

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

await vite.close();

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
