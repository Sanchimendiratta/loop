# Loop Lite — Implementation Design

Date: 2026-09-17
Source of truth: `../../XLRI_Referrals_LITE_v1.md` (Lite 1.0)
North star, not superseded: `../../../../XLRI_Referrals_PRD_v1.md` (PRD v1.3)
Derived from: the full v1.3 build on `main` (commit `c1f3312`, 48 commits, 209 tests)

## 1. Purpose

Build Loop Lite: eight screens, three sheets, no email. Lite's governing
principle is **"if a screen isn't in this doc, it isn't in v1"** — so this
document's job is as much about what leaves as what arrives.

## 2. Relationship to the build on `main`

`main` holds the complete v1.3 implementation. Lite is not a rewrite of it and
not a competitor to it: it is the launchable subset, on branch `feat/loop-lite`,
so the two can be compared before either ships.

Approach chosen (owner's call): **branch from `main`, prune, then build.** The
surviving core modules carry fix rounds worth keeping — `parse.ts` took two
heuristic corrections against the real §5.0 messages, and `verification.ts`
carries the multi-`@` Tier A bypass fix. Rebuilding them from the Lite doc
would silently discard both.

The risk of pruning is vestigial code, which is precisely the drift the full
build's final review caught (post visibility implemented four times). Two
mechanical guards make it findable: `npm run typecheck` on a strict config, and
the smoke script, extended here to fail on any module under `src/` that nothing
imports.

## 3. Lite's three settled decisions

Carried verbatim from the Lite doc, because they drive everything below.

**L1 — The directory and the separate referral-request object are cut.**
Applying to a *through me* post **is** the referral ask. One object instead of
two, one status ladder instead of two.

**L2 — Notifications are portal bell + browser push. No email.**

**L3 — Any verified member can post, with no pre-approval.** The connection
field and a real name on every post are the only controls.

## 4. What leaves, what reshapes, what arrives

### 4.1 Removed

| Removed | Files | Why |
|---|---|---|
| Alumni directory, company pages | `Directory.tsx`, `CompanyPage.tsx` | The expensive half (profiles, search, privacy rules, capacity). Lite needs no seeker→referrer matching. |
| The referral request as an object | `RequestComposer.tsx`, `RequestDetail.tsx`, `Requests.tsx`, `CapacityControls.tsx`, `core/requests.ts`, `core/capacity.ts` | L1: collapsed into apply. |
| Nudge engine | `core/nudges.ts` | Replaced by §6's 14-day amber dot — a sheet that nags by looking incomplete. |
| WhatsApp digest | the digest tab in `Admin.tsx` | L2. |
| Duplicate merge | `core/dedupe.ts`, `sharersFor` | Not needed below a few hundred posts. |
| The tracker | `Tracker.tsx` | Superseded by two purpose-built sheets (§6). |
| Vouching, reputation, benchmarks | `vouchingUnlocked`, `requiredVouches`, `vouch` rows | Already inert on `main`; Lite drops them outright. |
| Appeals | `submitAppeal`, `canAppeal` | Lite folds `verification_case` into `member`; §7 says a separate table only once appeals exist. |
| Profile and privacy settings | `Profile.tsx` | No directory means nothing to be visible in, and no blocked lists to maintain. |
| The card component | `PostCard.tsx` | The board is a table now (§4.2); a card renderer has no remaining caller. |
| The post detail screen | `PostDetail.tsx` | **Lite has no ninth screen.** §2 lists eight, and §6 puts Apply on the board row itself: "Apply logs the application and reveals the link, email or phone." The reveal is inline, not a separate view. |

**Deleting `core/privacy.ts` is deliberate and needs care.** Most of it exists to
protect a seeker from being discovered, which only matters with a directory. What
must survive is D2 — an unverified account sees nothing — which moves into the
store's viewer resolution. See §7.

### 4.2 Reshaped

| Surface | From | To |
|---|---|---|
| Job board | Cards, `PostCard.tsx` | A sortable **table** with filter chips. Lite §6: "no cards, no infinite scroll." |
| Disclosure | rung × destination, 20 combinations | Rung alone, four lines. Lite drops `destination_type` entirely. |
| Freshness | Confirm-or-decay, prompts at 14/28, auto-archive at 45 | Greys out and sinks at 30 days. **No auto-archive** — §6 says visible ageing only. |
| Verification | A status display | A real four-field submission form, plus the optional fifth (§3). |
| Post composer | Six required fields, destination confirmation, consent tick | Six required plus the connection field; `function` becomes a required dropdown. No destination, so no consent tick. |
| Admin console | Queue + reports + digest | Queue + report-driven delete. Two buttons per row; §3 calls that "the entire admin tool". |

### 4.3 New

- **`core/applications.ts`** — the seven-value status ladder and the 14-day
  staleness rule.
- **`core/notifications.ts`** — the three events that generate a bell item:
  *someone applied to your post*, *you were verified*, *a post you applied to
  was marked Filled*.
- **Bell** with unread count, in the shell.
- **My applications** sheet — inline status, no save button, no modal.
- **My posts** sheet — expandable applicant list.
- **Service worker** and push registration (§9 records what this can and cannot do).

## 5. Architecture

```
src/core/            pure, unit-tested
  time.ts            kept unchanged
  parse.ts           kept — paste-to-fill (§4), the thing that beats WhatsApp
  verification.ts    kept minus appeals
  rank.ts            kept — connection rung, then newest
  disclosure.ts      REWRITTEN to four rung-only lines
  freshness.ts       REWRITTEN to 30-day greying, no archive
  applications.ts    NEW — status ladder, staleness
  notifications.ts   NEW — the three bell events
src/data/
  schema.ts          rewritten to Lite's six tables
  seed.ts            rewritten — same five real messages, Lite's shapes
  store.ts           the repository boundary, considerably smaller
src/ui/              eight screens (§6)
  primitives.tsx     kept — including Modal's focus trap
  Shell.tsx          kept, plus the bell
  App.tsx            reshaped — Lite's nav
  VerificationGate   reshaped — now Get-verified form + Pending
  Board · PostComposer · MyApplications · MyPosts · Admin · Login
src/sw.ts            service worker
```

Anything under `src/ui/` not named above is deleted. The orphan check in §10 is
what stops that list from drifting out of date.

## 6. The eight screens

1. **Login** — Google sign-in only; no passwords, no OTP. A persona switcher
   stands in, as on `main`, and must include an unverified and a pending member
   or the gate is untestable.
2. **Get verified** — shown only off `@astra.xlri.ac.in`. Four fields: full name
   as on LinkedIn, LinkedIn URL, batch (year picker), programme (dropdown). Plus
   the optional *"Name one XLRI person who knows you"* → `member.known_by`.
   **College name is deliberately absent** — the platform is XLRI-only, so the
   answer is always the same and it verifies nothing.
3. **Pending** — a holding screen. Nothing else renders behind it.
4. **Job board** — the main sheet. Columns per §6; filter chips for function,
   location, experience, connection type; default sort connection rung then
   newest.

   **Apply is inline and there is no detail screen.** Tapping Apply logs the
   application and reveals the link, email or phone in place — a small inline
   panel or row expansion, not a navigation. The revealed route must not be in
   the DOM before the tap, which is the one D13 habit worth keeping from the
   full build even though Lite drops the destination taxonomy: the hiring
   contact is still a non-member who has not consented to a durable listing.
   The row states plainly that nothing is submitted on the member's behalf.
5. **Post a job** — a paste box that pre-fills fields 1–6, then six required
   fields plus the connection tap. Optional: compensation, JD link, one note.
6. **My applications** — one row per company+role. Status is one dropdown of
   seven values, changed in one tap: `Yet to respond` → `In review` →
   `Interview scheduled` → `Awaiting next round` → `Offer` · `Rejected` ·
   `No response`. A row untouched for 14 days shows a soft amber dot, and the
   sheet header reads "3 applications haven't been updated in a while."
7. **My posts** — applicants count, and expanding a row lists them. Poster's own
   status dropdown: `Open` · `Filled` · `Not sure`.
8. **Admin: verification queue** — name, batch, programme, LinkedIn link,
   requested-on. Approve / Reject. The LinkedIn URL is **text with a link the
   admin clicks themselves**; nothing fetches, embeds or previews it.

## 7. What the store still enforces

Far less than on `main`, and that is the point. Three rules remain:

1. **D2 — an unverified or pending member reads nothing.** Inherited from the
   full build and non-negotiable; it moves from `core/privacy.ts` into the
   store's viewer resolution, so deleting that module does not delete the rule.
2. **A member edits only their own application status**, and **a poster sets
   status only on their own posts.**
3. **Self-reporting is refused** — a member cannot report themselves or their
   own post.

Seeker-side caps stay absent. DL1 was a decision about the full build, but Lite
has no referral-request object to cap at all, so the question disappears rather
than being re-answered.

### 7.1 Privacy is maintained, and Lite is the stronger position

There is an apparent conflict between Lite §6 — the My-posts sheet shows the
poster each applicant's name, batch, programme and LinkedIn — and the full
build's `PublicMember`, which deliberately withholds exactly those fields. It
resolves cleanly once the distinction is stated:

**D6 protects a seeker from the network at large, not from a person they
deliberately approached.** Applying to a post is a voluntary, targeted
disclosure to one poster. Being discoverable in a directory is not. Dropping the
directory therefore *improves* the privacy position rather than weakening it:
with no directory and no member search, **"you applied to my post" becomes the
only path by which one member ever sees another's details.** On `main`, the
directory is a second path. Lite has one.

The rules, in order of importance:

1. **Applicant details reach exactly one person** — the poster of the post
   applied to. Not other applicants. Not an admin browsing the queue. Not a
   count or aggregate that identifies who applied. Enforced in the store, not in
   the sheet.
2. **No disclosure by surprise.** Before Apply is confirmed, the member is shown
   precisely which fields the poster will see: name, batch, programme, LinkedIn
   URL, and their self-reported status. Applying is consent, and consent
   requires knowing what is being consented to.
3. **A standing reminder, not a buried one.** My applications states that the
   poster of each role can see those fields. A member should be able to check
   what they have given away without reconstructing it from memory.
4. **D2 survives the deletion of `core/privacy.ts`.** An unverified or pending
   account reads nothing — not posts, not members, not counts. The rule moves
   into the store's viewer resolution so removing the module does not remove the
   guarantee. The smoke script's D2 assertion is carried forward unchanged.
5. **The contact route stays out of the DOM until Apply.** Kept from D13 even
   though Lite drops the destination taxonomy: the hiring contact is a
   non-member who never consented to appearing on a durable, searchable page.
   Not hidden with CSS — absent until the tap.
6. **Self-reporting refused, and reports do not expose the reporter** to the
   member reported.

What is *not* claimed: Lite has no confidential-search mode, because there is
nothing public to be absent from. A member who applies has disclosed to that
poster, and the product says so plainly rather than implying a protection it
does not provide.

## 8. Data — six tables

Per Lite §7, with `verification_case` folded into `member`:

`member` · `job_post` · `application` · `notification` · `push_subscription` ·
`report`

`notification` carries an `emailed_at` column, reserved and unused, so email can
be switched on later without rework (§5).

## 9. Push, and what it cannot do

§5 puts browser push in scope: a service worker and the Web Push API, no
third-party service, permission requested **after** the first successful action
and never on landing.

**The honest limit.** Web Push delivers through a push service, which requires a
server to send to it. This build has no backend (`localStorage` only). So:

- the bell, unread counts and the three events: **fully built**
- the service worker, permission flow and `push_subscription` shape: **built**
- in-session notifications via the Notification API: **work**
- delivery when the member is not on the site: **cannot work**, and is reported
  as a limitation rather than simulated

§5's own argument — that a bell alone means nobody comes back — stands. This
build cannot close that gap, and saying so is better than a fake that looks
closed.

## 10. Interface quality — friendly by craft, not decoration

Lite §6 is emphatic: "plain tables: sortable columns, filter chips above, no
cards, no infinite scroll." That austerity is correct — a sheet is the right
form for scanning twenty roles or tracking eight applications, and it is what
the owner asked for. Friendly therefore means **well-made**, not decorated.

The bar, and it is a requirement rather than a nicety:

- **Readable density.** Generous row padding and line height; tabular numerals
  for dates and year ranges so columns align; a clear type hierarchy so the role
  title reads first and the metadata second.
- **Plain language everywhere.** No jargon, no status codes shown raw. "Yet to
  respond", not `YET_TO_RESPOND`.
- **Empty states that say something true.** "Nothing here yet — post a role or
  check back tomorrow", never a blank panel or a generic illustration. The
  full build's "Nobody owes you anything right now" is the register to match.
- **One tap, no ceremony.** Status changes commit immediately — no save button,
  no modal, no page reload (Lite §6). Failure surfaces the store's own message
  inline, next to the control that failed, not in a banner elsewhere.
- **Keyboard and screen reader throughout.** Every control reachable by Tab in a
  sensible order; real `<table>` semantics with `<th scope>` so a screen reader
  announces column context; sort controls as buttons with `aria-sort`; the
  Modal's focus trap carried over from `main`; visible focus rings everywhere.
- **Mobile is a first-class layout, not a squeeze.** Lite is responsive web
  only, and India-first means a lot of phones. Rows collapse into stacked
  label/value pairs rather than scrolling sideways; filter chips wrap; the
  status dropdown stays thumb-reachable.
- **Nothing blocks on a spinner.** All data is local; a screen that appears to
  load is lying about the work it is doing.

None of this adds a screen or a feature. It is the difference between a table a
person uses daily and one they abandon.

## 11. Testing

Vitest over `src/core`, carrying forward the suites that still apply (`time`,
`parse`, `verification`, `rank`) and adding `applications` and `notifications`.
The rewritten `disclosure` and `freshness` get new tests against Lite's rules.

The smoke script is kept and extended: it renders all eight screens, keeps the
architecture guard (no `getState()`, `localStorage` or privacy imports in
`src/ui/`), keeps the D2 assertion, and gains an **orphan check** failing on any
module under `src/` that nothing imports — the guard against pruning vestiges.

## 12. Build order

Lite §8's five steps, unchanged, because they are ordered by what can be demoed:

| Step | Ships | Demo |
|---|---|---|
| 1 | Login, astra auto-verify, verification form, admin queue | "Only XLRI people get in" |
| 2 | Post a job (typed), board sheet, filters | "Here's every role, in one table" |
| 3 | Apply + My applications with inline status | "Here's where everything stands" |
| 4 | My posts with applicant list | "Partho, nine people applied to yours" |
| 5 | Bell, push, report link, paste-to-fill | "It tells you when something happens" |

Paste-to-fill is last **on purpose**: it is the best feature and the only one
that can slip without blocking a launch, because six short fields can be typed.
Since `parse.ts` already exists and is tested, step 5 is cheaper here than the
Lite doc assumes.

## 13. Success criteria

`npm run dev` brings Lite up; all eight screens are reachable; `npm run verify`
passes (typecheck, unit tests, smoke with the orphan check, production build);
the five real §5.0 messages each publish from the paste box; and a member can
walk login → board → apply → My applications → status change without touching a
removed surface.

Two additional gates, from the owner's explicit requirements:

- **Privacy holds.** An unverified viewer reads nothing (asserted in smoke); an
  applicant's details are readable by that post's poster and by no other member
  (asserted in the store suite); the contact route is absent from the DOM before
  Apply; and the pre-Apply disclosure names every field the poster will see.
- **The interface is usable, not merely correct.** Every sheet is navigable by
  keyboard alone, announces column context to a screen reader, and renders
  legibly at 390px wide. Checked by hand in a browser at both widths, reported
  per screen, not asserted in the abstract.

## 14. Deliberately not built

No alumni directory. No searching for people. No messaging. No email. No
resumes stored. No poster vetting. No automatic status — you tell it, it
remembers. No promise that any application goes anywhere.
