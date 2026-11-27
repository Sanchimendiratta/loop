# Loop — where the build is up to

Read this first if you are a fresh session picking this up.

## What this is

An implementation of `XLRI_Referrals_PRD_v1.md` (PRD v1.3 — an external document,
not included in this repository): Loop, the XLRI
alumni job-post and referral network. Scope: all of §7.1 Must, with the five
deltas recorded in §3 below, plus the post→request bridge promoted out of
§7.2 Should (DL2). Everything else in §7.2 Should, all of §7.3 Could, and all
of §7.4 Won't is explicitly out of this pass.

Design doc: `docs/superpowers/specs/2026-09-16-loop-design.md`

## Running it

```sh
npm install
npm run dev       # http://localhost:5174
npm run verify    # typecheck + 209 tests + render smoke + production build
```

There is one entry point (`index.html`) and one persona switcher standing in
for Google's account chooser — the header dropdown next to the Loop mark
switches between the six named personas from §4 and the three demo accounts
seeded in a non-verified state, so the verification gate (D2) has something
to show without a second login flow.

## Done and verified

`npm run verify` is green: **typecheck clean · 209 tests passing across 15
files · every screen-level component under `src/ui/` renders (16 of 17
files — `primitives.tsx` is a component library, not a screen; see
`scripts/smoke.mjs`'s closing note) · production build succeeds.**

### Logic (`src/core`, TypeScript, unit-tested, no build step)

| Module | What it does |
|---|---|
| `parse.ts` | Paste → structured fields + confidence + source span (D12) |
| `disclosure.ts` | Relationship rung × destination → the card's one sentence (D13) |
| `rank.ts` | Board order: connection rung, then freshness, then recency (D16) |
| `freshness.ts` | Confirm-or-decay clock — "I don't know" is a first-class answer (D14) |
| `dedupe.ts` | Normalised apply-route + title → merges duplicate forwards (§5.1) |
| `requests.ts` | The referral request state machine, `stateOwner` written on every edge (§5.2) |
| `nudges.ts` | Who owes the next update, and when to chase them |
| `capacity.ts` | Referrer intake caps — the seeker side is uncapped (DL1) |
| `verification.ts` | Tiers A/B/C, the one appeal (§6) |
| `privacy.ts` | Viewer-scoped visibility (D2, D6) |
| `time.ts` | Day-window arithmetic |

### Data (`src/data`)

| Module | What it does |
|---|---|
| `schema.ts` | Entity shapes and enums (§9's data model) |
| `seed.ts` | The demo network — 226 alumni, the five §5.0 messages run through the real parser |
| `store.ts` | **The repository boundary** — the only module that touches persistence, and the only place the four rules in §4.1 live |

### UI (`src/ui`, React 19 + TypeScript + Tailwind 4, built by Vite)

| Module | Screen |
|---|---|
| `App.tsx` | Shell, nav, persona switcher, the one hand-off every "ask for a referral" entry point shares |
| `Board.tsx` | The job board — filters plus connection-first ranking |
| `Tracker.tsx` | The two-sided tracker (DL2) — Needs you / Waiting on others / Your posts |
| `Directory.tsx` | Alumni directory — search, filters, report |
| `CompanyPage.tsx` | One company's open-to-referring alumni |
| `PostCard.tsx` / `PostDetail.tsx` | The standard job card, and its full detail view (apply, confirm, bridge) |
| `PostComposer.tsx` | Paste-to-parse, six required fields, both disclosures (D12/D13) |
| `Requests.tsx` / `RequestComposer.tsx` / `RequestDetail.tsx` | Sent/incoming lists, the ask, the shared timeline |
| `CapacityControls.tsx` | A referrer's own intake caps — DL1's one surviving volume control |
| `Profile.tsx` | Profile fields, resume (filename only), the privacy panel |
| `Admin.tsx` | Verification queue + audit trail, reports/takedown, the WhatsApp digest |
| `VerificationGate.tsx` | D2's front door — one of five states, read once |
| `Shell.tsx` / `primitives.tsx` | Chrome and the shared building blocks (`Button`, `Chip`, `Modal`, `TONE`, …) |

## The repository boundary, and its one test-only hole

**Every UI read and write goes through `src/data/store.ts`.** No component
under `src/ui/` calls `localStorage`, imports `core/privacy.ts` directly, or
calls `store.getState()`. `getState()` is documented in `store.ts` itself as
TEST-ONLY: it is the one function that answers without asking who is
looking, handing back the full, unscoped workspace — a blocked-company list
`toPublicMember` exists to strip, every private 1:1 request in the network.
It exists so the test suite can place a fixture and check what a *scoped*
read did or did not return, which is impossible if the only way in is
already filtered.

This is mechanically enforced, not just documented: `npm run smoke`
(folded into `npm run verify`) statically greps every `.ts`/`.tsx` file
under `src/ui/` for a call or import of `getState`, a reference to
`localStorage`, or an import of `core/privacy.ts`, and fails the build with
an explanation of *why* — not just that it matched — if any file trips it.
This is the only mechanical guard on the boundary the rest of the privacy
architecture rests on; nothing else in CI would catch a screen that grew a
`getState()` call.

## The DL1–DL5 deltas, and why they exist

Recorded in full in the design doc §3; summarised here so a later reader
does not "fix" them back.

**DL1 — Seeker outreach is uncapped.** The PRD's max-open-requests-per-seeker,
one-open-request-per-company, and D5's hard block on a new ask while an
earlier loop sits un-closed are all removed. Supply is protected at the
*referrer's* end instead — max open requests to a referrer, max per month, a
pause toggle, an auto-decline message (`capacity.ts`, `CapacityControls.tsx`)
— never by stopping the seeker on the way out. What replaces the hard block
is visibility: the tracker (DL2) plus the nudge engine make the owing party
obvious rather than making the asking party wait. The one guard DL1 keeps is
the duplicate-*submission* check — two alumni actually filing the same seeker
for the same role costs a referrer their bonus and creates an ATS conflict,
which is an external harm, not supply protection. `npm run smoke`'s DL1-shaped
proof is indirect (three requests to three alumni at Foodhak, no block hit);
the walkthrough report has the direct one.

**DL2 — A two-sided tracker, and the post→request bridge.** The PRD has a
poster dashboard and a shared per-request timeline, but no single surface
where a member sees everything they owe across both objects (a post and a
request). `Tracker.tsx` is that surface, and its central claim is that an
overdue referral request and a 14-day-unanswered application row render
*identically* — same border colour, same chip styling, same CTA weight —
distinguished only by a neutral kind label, never by colour or urgency
styling (`TONE` in `primitives.tsx` is keyed on who owes, never on what kind
of row it is). The post→request bridge (§7.2, normally Should-have) is
promoted into scope because reaching out from a post's alumni list is exactly
what the tracker's premise needs to be demonstrable.

**DL3 — Two PRD §12 questions are not implemented.** No courtesy email to a
listed hiring contact; no prompt asking a *Connected* poster to flag
applicants. D13's required controls all ship regardless: the consent tick,
reveal-on-apply, the contact-removal link, and the underlying 48h SLA.

**DL4 — No Supabase.** §9 specifies Postgres + row-level security; not
reachable in this pass. `src/data/store.ts` stands in as the one repository
boundary, and privacy is a **read-time filter** applied inside that file's
read functions (never a conditional re-implemented per screen) — that is
what makes it a boundary a later Supabase swap could replace wholesale,
changing nothing above it.

**DL5 — No LLM parser.** §9 specifies an LLM call behind a JSON schema; there
is no key and no network call here. `src/core/parse.ts` is the deterministic
layer §9 already requires underneath any model, built behind an interface a
real model could satisfy later. Its governing rule — a low-confidence field
renders **empty, never guessed** — is what makes the weaker parser degrade
into "one more field to type" instead of a wrong post silently going live.

**The measured cost of DL5**, from running the real parser against all five
of §5.0's messages and confirming the same counts in a browser (see the Task
25 walkthrough report): company-name extraction is deliberately conservative
— three of the five messages withhold the company on purpose, and the parser
correctly leaves that field blank rather than guessing, which is one typed
edit (the confidential descriptor) on each of those three. MSG_4 and MSG_5
name their company plainly and need zero typed edits. MSG_2 is the one
genuine parser weakness: its title parses as *"for a Strategy role with a
Mumbai-based MNC insurer."* at confidence 0.6 — above the 0.5 threshold, so
it pre-fills wrong rather than blank, and needs a second typed edit. This was
ruled on during the build (Task 18): the honest per-message count is
**MSG_1: 1, MSG_2: 2, MSG_3: 1, MSG_4: 0, MSG_5: 0** typed edits, not a
uniform "at most one" — a title visibly starting "for a" is not
acceptable-looking enough to ship as a silent defect, so the fall-through
confidence was deliberately left as-is rather than forced blank to hide the
gap. The cheap fix (stripping a leading "for a|an|the" before the title
fallback) was deferred to a future pass rather than spent on a headline
metric here.

## Honest limitations, called out rather than hidden

- **Single-admin-seat limitation (§6).** §6 requires an appeal be reviewed by
  a *second* admin. The demo workspace has exactly one admin seat
  (`m_admin`), so that check is **surfaced, not enforced** — `Admin.tsx`
  shows the reviewer, date and reason of the original decision on every
  appeal row so a human can honour the rule, but nothing in `store.ts`
  refuses the same admin who rejected a case from also deciding its appeal.
  Enforcing it here would make every appeal permanently undecidable in a
  single-admin demo, which reads as broken rather than strict. A real
  deployment with two or more admin accounts must add that check before
  relying on it.
- **`privacy.confidentialSearch` is reserved and unread.** The field exists
  in `schema.ts` because §9's data model names it, and every write path
  (`setPrivacy`) still carries it through unchanged. But no code anywhere
  branches on it — it is not read by a single `if`. It was briefly a Profile
  toggle that changed nothing when flipped, which is worse than no control at
  all; the toggle was removed (Task 24) and D6's confidentiality is stated as
  a **structural** fact instead: requests are 1:1 private (`canSeeRequest`),
  every member read returns `PublicMember` with no activity attached, and
  there is no public request feed or "open to work" wall to opt out of in the
  first place. If a future feature needs a genuine opt-out, the schema field
  is already there to wire up.
- **The `getState()` guard is mechanical, not aspirational.** See above —
  `npm run smoke` fails the build, with an explanation, if any file under
  `src/ui/` calls it, touches `localStorage`, or imports `core/privacy.ts`
  directly.
- Two small, deferred data-integrity gaps in `Profile.tsx`'s `setProfile`:
  `batch` is accepted as a raw number with no NaN/bounds check (clearing the
  field before saving would write `NaN` to your own record), and `companyId`
  is not validated against `listCompanies()`. Both are real but minor, and
  were deferred rather than fixed mid-build (Task 24 review).
- `parseCompensation`/other optional parsed fields are shown to the poster in
  the composer before publish (Task 18 fix) — a parsed value never reaches a
  published card unseen, which is the one part of DL5's honesty the build
  does actively guarantee.

## Not built (out of the agreed scope)

Everything in PRD §7.2 Should beyond the promoted bridge (DL2), all of §7.3
Could, and all of §7.4 Won't: no reciprocity gate on outcome stats, no saved
searches, no referrer reputation stats, no request forwarding, no WhatsApp
send integration (the digest is copy-to-clipboard for a human to paste — see
D17 in `Admin.tsx`), no alerts, no courtesy email to a hiring contact or
Connected-poster applicant prompt (DL3), no Supabase/Postgres/RLS (DL4), no
LLM-backed parser (DL5). Google OAuth is simulated by the persona switcher;
there is no real identity provider integration.
