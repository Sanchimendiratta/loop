# Loop Lite — where the build is up to

Read this first if you are a fresh session picking this up.

## What this is

Loop Lite: a launchable subset of Loop, the XLRI (Jamshedpur) alumni job-post
and referral network. This is branch `feat/loop-lite`, branched from `main`
(the full v1.3 build, commit `c1f3312`) and then pruned before Lite-specific
work began — it is **not** a rewrite of `main` and not a replacement for it;
the two exist side by side so they can be compared before either ships.

- Source of truth for what Lite must do: `docs/XLRI_Referrals_LITE_v1.md` (Lite 1.0)
- North star, not superseded: `../XLRI_Referrals_PRD_v1.md` (PRD v1.3, one level up from this repo)
- Implementation design, with the reasoning behind every decision below:
  `docs/superpowers/specs/2026-09-17-loop-lite-design.md`
- The full v1.3 build this branched from: `main`, documented by that
  branch's own `STATE.md`

Lite is eight screens, three sheets, no email, and its governing rule is
**"if a screen isn't in this doc, it isn't in v1."** Concretely, against
`main`:

- **Gone entirely:** the alumni directory and company pages, the referral
  request as a separate object (an apply *is* the ask now — one status
  ladder, not two), the nudge/email engine, the WhatsApp digest, duplicate
  merge, the two-sided tracker, vouching/reputation, appeals, profile/privacy
  settings, the referral-request-only screens (`Requests.tsx`,
  `RequestComposer.tsx`, `RequestDetail.tsx`, `CapacityControls.tsx`,
  `Tracker.tsx`, `Directory.tsx`, `CompanyPage.tsx`, `PostCard.tsx`).
- **What replaced it:** three sheets — the job board, My applications, My
  posts — plus Login, the verification gate/form, the post composer, and
  Admin. That is the full eight-screen surface (§13's count includes the
  gate's Pending/Rejected/Get-verified states as branches of one
  `VerificationGate.tsx`, not separate screens).
- **What survived unchanged, on purpose:** `core/parse.ts` (two heuristic
  fixes against the real §5.0 messages already earned), `core/verification.ts`
  (the multi-`@` Tier A bypass fix). Rebuilding either from the Lite doc from
  scratch would have silently thrown both away.

## Running it

```sh
npm install
npm run dev       # http://localhost:5174
npm run verify    # typecheck + 151 tests + render smoke (with the orphan check) + production build
```

One entry point (`index.html`), one persona switcher standing in for Google's
account chooser — the header dropdown next to the Loop mark switches between
the eight seeded personas (six verified across every connection type, one
pending, one rejected), so D2 and the verification gate have something to
show without a real OAuth flow.

## Done and verified

`npm run verify` is green: **typecheck clean · 151 tests passing across 14
files · every screen-level component under `src/ui/` renders, with markup
checked for `NaN`/`undefined`/`[object Object]` · the orphan check (module-
and screen-level) · production build succeeds.**

### The three Lite decisions (design doc §3), and where they live

- **L1 — no directory, no separate request object.** Applying to a post *is*
  the ask; one `application` row, one status ladder. `store.applyToPost` /
  `store.myApplications`.
- **L2 — notifications are the portal bell + browser push, no email.**
  `notification.emailed_at` exists in the schema and is written as `null` on
  every notification, reserved so email could be switched on later without a
  schema change — nothing reads it. `Bell.tsx`, `src/sw.ts`.
- **L3 — any verified member can post, no pre-approval queue.**
  `store.publishPost` has exactly two refusals (missing title, missing
  connection) plus one conditional one (a confidential post with no
  descriptor) — no admin gate in between.

### Logic (`src/core`, unit-tested, no build step)

| Module | What it does |
|---|---|
| `parse.ts` | Paste → structured fields + confidence + source span; a field below `MIN_CONFIDENCE` renders empty, never guessed |
| `disclosure.ts` | Connection rung → the board's one honest sentence, and the rung ranking order |
| `rank.ts` | Board order: connection rung, then recency — a stale post sinks because it is older, not through a separate rule |
| `freshness.ts` | `postAge`: a post 30+ days old greys and sinks; nothing is ever hidden |
| `applications.ts` | The status ladder, labels, and the 14-day stale-application dot |
| `notifications.ts` | Notification body text per event kind, unread counts |
| `verification.ts` | Domain auto-verify vs. admin review (Tier A/B) |
| `time.ts` | Day-window arithmetic (`daysBetween`, `DAY_MS`) |

### Data (`src/data`)

| Module | What it does |
|---|---|
| `schema.ts` | Lite's **six** tables: `member`, `job_post`, `application`, `notification`, `push_subscription`, `report`. `verification_case` is folded into `member` (no appeals); `notification.emailed_at` is reserved and unused. |
| `messages.ts` | The five real §5.0 WhatsApp-forward messages, verbatim (emoji, broken lines, inconsistent labels included) |
| `seed.ts` | The demo network — 8 members, the five real messages run through the actual parser, a deterministic function of `now` (pinned byte-for-byte by `test/seed.test.ts`) |
| `store.ts` | **The repository boundary.** The only module that touches persistence, and the only place D2 and rule 2 (below) live. |

### UI (`src/ui`, React 19 + TypeScript + Tailwind 4, built by Vite)

| Module | Screen |
|---|---|
| `Login.tsx` | Screen 1 — Google sign-in stand-in (two simulated domains) + the persona switcher's list |
| `VerificationGate.tsx` | D2's front door: Get-verified form, Pending screen, Rejected screen, or `children` — one of four, read once from `getCurrentMember()` |
| `Board.tsx` | The job board sheet — filters, connection-first ranking, inline apply, inline report |
| `PostComposer.tsx` | Paste-to-fill (`function`/`connection` always manual, by design) or six fields typed by hand |
| `MyApplications.tsx` | My-applications sheet — one-tap status ladder, the 14-day stale dot |
| `MyPosts.tsx` | My-posts sheet — applicant list per post, the Filled confirm step |
| `Admin.tsx` | The whole admin tool: verification queue, decided audit trail, reports → delete |
| `Shell.tsx` / `Bell.tsx` | Chrome, nav, and the bell (in-session `Notification` API, no background delivery) |
| `primitives.tsx` / `useStore.ts` | Shared building blocks and the two `useNow`/`useStoreVersion` hooks — no screen of their own |

## The repository boundary, and its one test-only hole

**Every UI read and write goes through `src/data/store.ts`.** No component
under `src/ui/` calls `localStorage`, imports `core/privacy.ts` (deleted in
Lite — D2 now lives in `store.viewerOrNull()`), or calls `store.getState()`.
`getState()` is documented in `store.ts` as TEST-ONLY: it answers without
asking who is looking, bypassing D2 and rule 2 (below) at once. It exists so
tests (and this smoke script) can assert on the unscoped truth to check what
a *scoped* read did or did not return — impossible if the only way in is
already filtered.

This is mechanically enforced, not just documented: `npm run smoke` (folded
into `npm run verify`) statically greps every `.ts`/`.tsx` file under
`src/ui/` for a call or import of `getState`, a reference to `localStorage`,
or an import of `core/privacy.ts`, and fails the build — with an explanation
of *why*, not just that it matched — if any file trips it.

The same script also runs an **orphan check**: any module under `src/` that
nothing else in `src/` imports fails the build (excluding `main.tsx`, the
Vite entry, and `sw.ts`, registered by URL). This is the mechanical half of
the design doc's §2 argument against pruning a branch and leaving vestiges —
Task 1's post-visibility-implemented-four-times bug on `main` is exactly the
class of thing it is meant to catch. It has a narrower, screen-shaped cousin
right next to it: every `src/ui/*.tsx` file must be rendered by the smoke
script or named, with a reason, on an exempt list (currently `Bell.tsx`,
rendered inside `Shell`'s render rather than standalone, and `primitives.tsx`,
a component library with no screen-level target of its own) — because a
module only `App.tsx` imports is not an orphan by the first check's
definition, but it can still have zero automated coverage. That gap was real
once: as of Task 11, `MyApplications.tsx`, `MyPosts.tsx` and `Login.tsx`
existed with no render coverage of any kind. Both checks are green now.

## Two rules the store enforces on every read, no exception

1. **D2 — an unverified account reads nothing.** `store.viewerOrNull()` is
   the one gate every exported read begins with; a `pending` or `rejected`
   member gets `[]`/`null` back from everything except their own submitted
   evidence (name, batch, programme, LinkedIn, `knownBy` — theirs to see,
   never a leak). Asserted in `scripts/smoke.mjs` against `App`'s full render
   (calibrated with a positive control against a verified viewer first, so
   the detector is proven able to fail), and walked by hand in a real browser
   for this task (see the Task 14 report).
2. **Rule 2 — an applicant's details reach exactly one person: that post's
   poster.** `store.applicantsFor(postId)` is the *only* place a member ever
   reads another member's data, and it has no admin branch on purpose — "the
   rule has one exception" is how a rule stops being one. Pinned three ways:
   `test/store.test.ts`, `scripts/smoke.mjs`'s field-scoping assertion (which
   checks a real four-applicant post from every other seeded member,
   including the admin persona, and gets `[]` every time), and hand-checked
   in a browser for this task.

Two more invariants worth knowing before touching `Board.tsx` or `store.ts`:

- **The apply route is absent from the DOM, not just hidden, before Apply.**
  `Board.tsx` renders no `href`/`mailto:`/`tel:` for a post until
  `applyToPost` has actually run — `RouteDisplay` only mounts once
  `applicationFor(post.id)` returns a row. Confirmed in this task's
  walkthrough by grepping full page HTML for the exact apply value before and
  after confirming.
- **Nothing in this app fetches, embeds, or previews a LinkedIn URL** (§7.4).
  Every LinkedIn value — the pending screen's own evidence, `MyPosts.tsx`'s
  applicant rows, `Admin.tsx`'s queue — renders as a plain `<a>` the viewer
  clicks themselves. There is no fetch, no `<img>` favicon lookup, no
  metadata call anywhere in `src/`.

## Honest limitations, stated rather than hidden

- **Background push cannot work.** This build has no server
  (`src/data/store.ts` is `localStorage` only), and Web Push delivery needs
  one to hand a subscription to. The bell, unread counts, the three
  notification events, the service worker and the subscription shape are all
  **built**; in-session delivery via the `Notification` API **works**;
  delivery while the member is not on the site **cannot work**, and
  `Bell.tsx`'s own copy says so rather than simulating it.
- **No appeals.** Lite folds `verification_case` into `member` (design doc §3,
  following the source spec) — there is no second-reviewer path. A rejected
  member reads the decision note and is told who to contact
  (`VerificationGate.tsx`'s `RejectedScreen`), not offered a retry button.
- **No confidential-search mode**, because there is nothing public to be
  absent from: Lite has no directory and no "open to work" wall. Applying
  discloses to that post's poster and only that poster, and every screen that
  mentions it says so in plain language rather than promising a toggle that
  does nothing (the design doc's cautionary example, from `main`'s own
  `privacy.confidentialSearch` field, which shipped inert once).
- **`getState()` is test-only and mechanically guarded** — see above. It is
  the only intentional hole in the repository boundary, and it cannot be
  reached from `src/ui/` without failing `npm run smoke`.
- **The parser's company-name weakness**, measured honestly rather than
  tuned to look good: run live, through the paste box, against all five real
  §5.0 messages, the count of fields still needing to be typed by hand (of 7:
  title, company/descriptor, location, experience, apply route, plus
  `function` and `connection`, which are never parsed by design) is **3, 3,
  3, 2, 2**. In every case but one the only blank is the confidential
  descriptor (msgs 1–3 all withhold the company name in the original
  message, which the parser correctly leaves blank rather than guessing —
  `MIN_CONFIDENCE` doing its job). The one real parser weakness: MSG_2's
  title parses as *"for a Strategy role with a Mumbai-based MNC insurer."* —
  non-null and therefore counted "filled" by a bare null-check, but not a
  title anyone would actually publish as typed. `messages.ts` and `parse.ts`
  were deliberately **not** touched to improve this number — it is a
  measurement of what ships today, not a target to hit. Full counts and the
  browser session that produced them are in the Task 14 report.
- **Login is implemented and rendered (by the smoke script and by
  `VerificationGate.tsx` importing it), but is not reachable from the running
  app by any interaction found during this task's walkthrough.** `main.tsx`
  always seeds or rehydrates into a valid, already-signed-in
  `currentMemberId` (the seed's default is `m_ananya`); there is no sign-out
  affordance anywhere in `src/ui/`, and `beginNewSignIn`'s "new Google
  sign-in" options land on the Get-verified form, not on `Login`. Clearing
  `localStorage` and reloading was tried and still lands signed in as Ananya.
  This is flagged here rather than patched, because adding a sign-out control
  would be a `Login.tsx`/`App.tsx` design change this task does not own —
  see the Task 14 report for the full walkthrough this was found during.

## Deliberately not built (spec §14)

No alumni directory. No searching for people. No messaging. No email. No
resumes stored. No poster vetting. No automatic status change — the member
tells the sheet, it remembers. No promise that any application goes
anywhere. (This is the design doc's own §14, carried forward verbatim; it is
not a gap list, it is the product's actual shape.)
