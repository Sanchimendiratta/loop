# Loop — Implementation Design

Date: 2026-09-16
Source of truth: `../../../../XLRI_Referrals_PRD_v1.md` (PRD v1.3)
Sibling product: `../../../../pipelined/` — employer-side, separate app, no shared code.

## 1. Purpose

Build a runnable implementation of Loop: the XLRI alumni job-post and referral
network. Two objects (§5), verified membership (§6), and a two-sided tracker
that makes whoever owes the next update impossible to ignore.

## 2. Scope

**In: all of §7.1 Must**, with the deltas in §3 below, plus one item promoted
from §7.2 (the post→request bridge, DL2).

**Out:** the rest of §7.2 Should, all of §7.3 Could, and everything in §7.4
Won't. Specifically out: the reciprocity gate on outcome stats, saved searches,
referrer reputation stats, request forwarding, WhatsApp nudges, alerts.

## 3. Decisions taken here (deltas from the PRD)

These change documented PRD behaviour. Recorded so a later reader does not
"fix" them back.

**DL1 — Seeker outreach is uncapped.** Removes three things §7.1 and §8
specify: max open requests per seeker, max one open request per company per
seeker, and D5's block on new requests while an earlier loop sits un-closed.

*Why:* owner decision. D5 protected referrer supply by blocking the sender. It
is replaced by visibility — the tracker (DL2) plus the existing nudge engine
make the owing party obvious rather than making the asking party wait.

*What still protects supply:* §7.1's **referrer-side** capacity controls are
unchanged and become the primary backstop — max open requests to a referrer,
max referrals per month, pause toggle, auto-decline message. A referrer caps
their own intake; a seeker is never capped on the way out.

*Consequence to accept:* closure is now nudged, not enforced. Loop closure rate
(§11, >70%) is the metric that will show if this was wrong. If it sags, the
cheapest correction is a soft one — surfacing a seeker's un-closed count to
referrers deciding whether to accept — not restoring the hard block.

**Retained:** §8's guard against two alumni submitting the same seeker to the
same role. That prevents a referral-bonus conflict and an ATS collision on the
company's side, which is an external harm, not supply protection.

**DL2 — A two-sided tracker, and the post→request bridge.** The PRD has a
poster dashboard (§5.1) and a shared timeline (§5.2) but no surface where one
member sees everything they owe across both objects. The tracker is that
surface. The §7.2 bridge is promoted into scope because reaching out from a
post is precisely what it does.

**DL3 — §12 Q6 and Q7 are not implemented.** No courtesy email to a listed
hiring contact; no prompt asking a *Connected* poster to flag applicants. D13's
required controls (consent tick, reveal-on-apply, removal link, 48h) all ship.

**DL4 — No Supabase.** §9 specifies Postgres + RLS. Not reachable here. One
`data/store.ts` repository boundary stands in, and **privacy is a read-time
filter** (§7) rather than a conditional in each screen — that is what makes it
a boundary swappable for RLS.

**DL5 — No LLM parser.** §9 specifies an LLM call behind a JSON schema. No key,
no network. The deterministic layer §9 already requires is built, behind an
interface an LLM implementation can satisfy later. §9's own rule — the model
never publishes, it only pre-fills a form a human confirms — is what makes a
weaker parser degrade instead of break. See §5 for what this costs.

## 4. Stack

React 19 · TypeScript · Tailwind 4 · Vite — as §9 specifies, and matching the
tooling already proven in `pipelined/`. Tests: Vitest.

Unlike Pipelined, the domain layer is TypeScript, not JS-with-JSDoc. Pipelined
kept plain JS because its tested core predated the toolchain; a greenfield
project has no such reason, and a hand-maintained type mirror would be two
sources of truth.

```
src/core/     pure, dependency-free, unit-tested
  parse.ts        paste → structured fields + confidence + source spans (D12)
  disclosure.ts   relationship × destination → the card's sentence (D13)
  rank.ts         connection rung, then freshness, then recency (D16)
  freshness.ts    confirm-or-decay clock (D14)
  dedupe.ts       normalised route + title → merge across posters
  requests.ts     referral request state machine (§5.2)
  nudges.ts       who owes the next update, and when to chase
  capacity.ts     referrer intake caps (seeker side is uncapped, DL1)
  verification.ts tiers A/B/C, appeal (§6); Tier C gated on 200+ verified
                  members, so the seed carries enough accounts to exercise it
  privacy.ts      viewer-scoped visibility (D2, D6)
  time.ts         day-window arithmetic
src/data/
  schema.ts   entity shapes and enums (§9's data model)
  seed.ts     demo network, seeded from §5.0's real messages
  store.ts    THE repository boundary; enforces the four rules in §4.1
src/ui/       React screens
test/         Vitest over src/core
```

### 4.1 What the store enforces, so no screen can route around it

1. **The privacy filter** (§7) — every read is viewer-scoped.
2. **The duplicate-submission guard** — one seeker, one role, one submission.
3. **Referrer capacity** — intake caps, pause, auto-decline (§7.1).
4. **State transitions** — only the owner of a state may advance it, and only
   along the edges in §8. An invalid transition is refused, not corrected.

Seeker outreach limits are deliberately absent from this list (DL1).

## 5. Parsing (D12)

Deterministic extraction, per-field, each returning a value, a confidence, and
the source span it came from so the composer can highlight it (§5.1 requires
the poster can see nothing was invented).

| Field | Method | Reliability |
|---|---|---|
| Apply route | URL / email / phone regex | High — present in all five §5.0 messages |
| Experience band | year-range and seniority-word mapping | High |
| Location | city gazetteer + Remote/Hybrid keywords | High |
| Compensation | ₹ / L / LPA / Cr patterns | High when present (1 of 5) |
| Role title | line-position + title-word heuristics | Medium |
| Company vs confidential | named-entity heuristics | **Low — the weak point** |

**The honest cost of DL5.** Company-name-versus-confidential-descriptor is the
judgement §9 assigned to the model, and three of §5.0's five messages withhold
the name. The deterministic layer will often leave it blank. Per §9 a
low-confidence field renders **empty, never guessed**, so the failure mode is a
poster typing one field — not a wrong post. The metric at risk is §11's
<60s median paste→publish, not correctness.

**Destination type** (D13 field 2) is inferred from the parsed route: a careers
domain → `company_ats`; a personal name/address → `named_person`; a known
search-firm domain pattern → `external_recruiter`; a jobs-platform domain →
`third_party_platform`. Inference is a suggestion the poster confirms in one
tap, never a silent classification.

## 6. Disclosure (D13) — one generator, not twenty strings

The card's sentence is composed from two clauses, not looked up: the rung
supplies what the poster can do, the destination supplies where the CV lands.
Four rungs × five destinations stay consistent because neither half is written
twice. Tested against §5.1's four worked examples verbatim.

This is the single most consequential string in the product — §5.1 calls the
*Forwarded · External recruiter* line the most useful sentence on the platform —
so it lives in one tested module and the card cannot compose its own.

## 7. Privacy as a read-time filter (D2, D6)

Every read takes the viewing member and returns only what they may see:

- An unverified account sees nothing (D2). Not a redirect — an empty result.
- A seeker's activity is invisible to the network (D6). A referral request is
  readable by exactly its two parties, plus admins.
- Profiles are visible to verified members only.
- A seeker may block named companies and named individuals from seeing their
  profile (§8).
- Hiring contact details are members-only, revealed on **Apply** (which logs the
  applicant), never rendered on the card, never indexed (D13).

Enforced at the store boundary because the alternative — each screen checking —
is how one screen eventually forgets. This is the RLS stand-in.

## 8. The request lifecycle (§5.2)

States and their owner. `state_owner` is stored, not inferred, because the
tracker and the nudge engine must not be able to disagree about whose turn it is.

| State | Set by | Owes next |
|---|---|---|
| `sent` | Seeker | Referrer — 7 days to respond, then auto-expire |
| `declined` | Referrer | — terminal, reason chip shown to seeker |
| `accepted` | Referrer | Referrer — must submit |
| `submitted` | Referrer | Seeker — must report the outcome |
| `recruiter_contact` | Either | Seeker |
| `interviewing` | Seeker | Seeker |
| `offer` / `rejected` / `no_response` | Seeker | — terminal |
| `expired` | System | — no referrer response in 7d; not held against the seeker |
| `expired_unsubmitted` | System | — accepted but never submitted by day 14 (§8) |
| `role_closed` | Referrer | — returns to seeker to pick another alum; not a decline (§8) |

**Nudges.** Referrer at day 3 and 6 of `sent`. Referrer at day 7 of `accepted`.
Seeker at day 14/30/45 after `submitted`; three ignored → auto `no_response`.
Under DL1 that auto-close no longer blocks anything — it records.

## 9. Job posts

**Freshness (D14).** Prompts at day 14 and 28: *Still open / Filled / I don't
know*. "I don't know" is first-class — a *Forwarded* poster genuinely cannot
know, and forcing a yes/no manufactures confidence. No response → visibly ages
to "Unconfirmed — last confirmed N days ago" and deranks. Day 45 → auto-archive.
*Filled* archives immediately and notifies everyone who logged an apply.

**Ranking (D16).** Connection rung first, then freshness, then recency. Cold
forwards are allowed and honestly badged, but never top the board.

**Dedupe.** Hash of normalised apply route + normalised title. Merges into one
card reading "Also shared by Rhea, Karan +2" — corroboration, not clutter.

**Apply tracking.** Tapping apply logs intent and reveals the route. Day-14
prompt: *Heard anything? Yes / No / Rejected*. Never blocks anything (§5.1).
Where nobody answers, the card reads "14 applied · outcomes unknown" — §8 is
explicit that honest absence beats a fabricated denominator.

Because §7.2's reciprocity gate is out of scope (§2), these stats are visible to
every verified member, not only to those who answer their own prompts. PRD §5.1
assumes the gate; this build does not have it.

## 10. The tracker (DL2)

One surface, rendered from the viewer's side, covering both objects.

- **Needs you** — rows where `state_owner` is the viewer. Sorted by how overdue.
- **Waiting on others** — rows owed by the counterparty, showing who and since
  when: "Waiting on Meera — nudged 2 days ago."
- **Your posts** — for a poster: views, applies and heard-back per post, which
  is §5.1's poster dashboard folded in rather than given its own screen.

Every row carries exactly one primary action and nothing else (§5.2). A row's
CTA and its urgency come from `state_owner` and the due date, so an overdue
referral request and an unanswered apply prompt read identically — the same
principle Pipelined applies to its overdue feed, for the same reason: a second
accountability system is one nobody learns.

## 11. Screens

Sign-in and verification gate (persona switcher stands in for Google OAuth,
exercising the real verification and privacy checks) · job board · paste-to-parse
composer · post detail, with the bridge to a referral request · **tracker** ·
directory · company page · request composer · request detail with the shared
timeline · incoming requests with referrer capacity controls · admin console
(verification queue, reports and takedown, the D17 WhatsApp digest) · profile
and privacy settings.

## 12. Testing

Vitest over `src/core`. §5.0's five verbatim messages are the parser's fixture
set — including the three that withhold the company and the one that routes to
a search firm, which is the case D13 exists for.

- `parse` — the five messages; low confidence yields empty, never a guess
- `disclosure` — §5.1's four worked sentences, verbatim
- `rank` — rung order, unconfirmed deranking
- `freshness` — day 14/28/45 boundaries, all three confirm answers
- `dedupe` — merge across posters, route normalisation
- `requests` — every transition, and every one that must be refused
- `nudges` — schedules, and the three-ignored auto-close
- `capacity` — referrer caps bind; **seeker caps do not exist** (DL1 regression test)
- `privacy` — a visibility matrix per viewer type, including unverified sees nothing

## 13. Success criteria

The app runs; every §7.1 Must is reachable in the UI; the deltas in §3 hold;
`npm run verify` (typecheck, unit tests, render smoke, production build) passes;
and the §5.0 messages can each be pasted into the composer and published.

## 14. Explicitly not built

Resume review, mock interviews, mentorship, salary data, events, chat/DM,
payments, non-XLRI schools, current students, WhatsApp notification sending,
mobile apps, ATS integration. Nothing scrapes LinkedIn — a profile URL is text a
member pastes, never fetched (§7.4, carried from Pipelined D4).
