**Lite Scope — build this first**

**Loop Lite**

*Eight screens. Three sheets. No email.*

| Field | Detail |
| :-- | :-- |
| Version | Lite 1.0 — a buildable subset of `XLRI_Referrals_PRD_v1.md` (v1.3). The full PRD stays the north star; nothing here contradicts it, it just does less. |
| Date | 16 September 2026 |
| Principle | If a screen isn't in this doc, it isn't in v1. |
| Settled | **L1** — directory and the separate referral-request object are cut; applying to a *through me* post **is** the referral ask. **L2** — notifications are portal bell + browser push, no email. **L3** — any verified member can post, with no pre-approval; the connection field and a real name on every post are the only controls. |

---

# 1. What Lite keeps, and what it drops

**Keeps:** verified login, the job board, posting a job, applying, and tracking your own status.

**Drops for now — and why:**

| Dropped | Reason |
| :-- | :-- |
| The alumni directory | It is the expensive half (profiles, search, privacy rules, capacity controls) and it is only needed for seeker→referrer matching. Nothing in your walkthrough needs it. |
| The referral request as a separate object | Collapsed into apply. If a post's route is *through me*, applying **is** the referral request. One object instead of two, one status ladder instead of two. |
| Email, nudge engine, WhatsApp digest | Per your call. See §5 for what replaces the pull. |
| Duplicate merge, vouching, reputation, benchmarks | Not needed below a few hundred posts. |

This collapse is the single biggest simplification available. It takes the build from roughly twenty features to seven screens, and everything dropped can be added later without reshaping the data.

---

# 2. Screens — the whole product

1. **Login**
2. **Get verified** (only if not on `@astra`)
3. **Pending** (holding screen)
4. **Job board** — the main sheet
5. **Post a job**
6. **My applications** — the second sheet
7. **My posts** — who applied to mine
8. **Admin: verification queue** *(you only)*

---

# 3. Login and verification

**Google sign-in only.** No passwords, no email/OTP.

- Signs in with **`@astra.xlri.ac.in`** → verified instantly, straight to the board.
- Signs in with any other Google account → **Get verified** form → Pending screen until an admin decides.

### The verification form — four fields

| Field | Input | Why |
| :-- | :-- | :-- |
| Full name (as on LinkedIn) | Text | The thing being matched |
| LinkedIn profile URL | URL | The evidence |
| **Batch / graduation year** | Year picker | **Suggested replacement for "college name."** The single most useful cross-check — the admin opens LinkedIn and looks for exactly this. |
| **Programme** | Dropdown: BM · HRM · GMP · PGDM (GM) · FPM · Other | Narrows it further, and is a quiet authenticity check — someone who didn't go to XLRI usually picks wrong. |

**On "college name":** drop it. The platform is XLRI-only (PRD D7), so the answer is always "XLRI" — it verifies nothing and costs a field. Batch + programme are what an admin actually checks the LinkedIn page against.

**Optional fifth field, worth having:** *"Name one XLRI person who knows you."* Free text, not enforced. Costs nothing, and gives you a second thread to pull when a LinkedIn profile is thin or ambiguous.

### Admin queue

A table: name, batch, programme, LinkedIn link, requested-on. Two buttons per row — **Approve** / **Reject**. Clicking the LinkedIn link opens it in a new tab. That is the entire admin tool.

---

# 4. Posting a job

**Any verified member can post (L3).** No pre-approval, no poster role, no invite. This matches how the group works today — anyone can forward — and the controls are that the connection field forces honesty and the poster's real name and batch sit on every card. A **Report** link on each post and an admin delete are the whole moderation story.

One form. **Six required fields, all dropdown or short text.** Target under a minute.

| # | Field | Input |
| :-- | :-- | :-- |
| 1 | Role title | Text |
| 2 | Company | Text, **or** tick *Confidential* + one line ("impact-tech startup, ₹300Cr revenue") |
| 3 | **Function** | Dropdown — HR · Marketing & Brand · Sales & BD · Finance · Strategy & Consulting · Operations & Supply Chain · Product & Program · Analytics & Data · General Management · Other |
| 4 | Location | Text + a *Remote* tick |
| 5 | Experience | Two numbers: min–max years. The board derives the seniority label for filtering, so the poster only fills one thing. |
| 6 | How to apply | Link · Email · Phone · **Through me** |
| 7 | **Your connection to this role** | One tap: *I'm hiring* · *I work here* · *I know the hiring contact* · *Just passing it on* |

**Optional:** compensation (free text), JD link, one note.

**Paste-to-fill stays**, because it is the thing that beats WhatsApp — a *Paste your WhatsApp message* box at the top pre-fills fields 1–6. If parsing isn't ready on day one, the form still works typed; it is six short fields.

Field 7 is what makes the post honest. It shows on every card as a badge and one line: *"Partho doesn't work here but knows the hiring contact"* or *"Partho has no connection — this is a cold application."*

---

# 5. Notifications — bell + browser push, no email (L2)

**In the portal:** a **bell icon** with an unread count and a list. Three things generate one — *someone applied to your post*, *you were verified*, *a post you applied to was marked Filled*.

**Browser push:** the same three events, delivered when the member isn't on the site. No per-message cost, no phone numbers, no third-party service — a service worker and the Web Push API. Works on desktop and Android; on iPhone once the site is saved to the home screen. Permission is requested **after** the first successful action, never on landing.

**Why push is in scope and not deferred:** a bell alone means nobody comes back on their own. A poster who gets five applicants never learns unless they happen to log in, and that is the single thing most likely to make Lite feel dead. Push is the pull mechanism, and it is the only one that costs nothing.

**On cost, for the record:** email at your volume would also have been free — Resend gives 3,000/month and Supabase includes auth mail. Portal-only is the right call for simplicity, not savings. A hook stays in the notification table so email can be switched on later without rework.

---

# 6. The two sheets

Both are plain tables: sortable columns, filter chips above, no cards, no infinite scroll.

### Sheet 1 — Job board

| Role | Company | Function | Location | Exp | Comp | Posted by | Posted | |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| Head of Operations | Anveshan | Ops & Supply Chain | Manesar | 10–15y | — | Partho · *knows contact* | 2d ago | **Apply** |
| Brand Marketing Mgr | FOODHAK | Marketing | UK / US / ME | 3–6y | — | Rhea · *hiring* | 5d ago | **Apply** |
| AD/Director, P&C | *Confidential* | HR | Bangalore | Senior | ₹30–40L | Partho · *forwarded* | 9d ago | **Apply** |

**Filter chips:** Function · Location · Experience · Connection type. **Default sort:** connection rung, then newest.

**Apply** logs the application and reveals the link, email or phone. Nothing else happens — the platform does not submit anything on your behalf, and the card says so.

### Sheet 2 — My applications

The screen you described. One row per company+role, status editable inline.

| Company | Role | Applied | Via | **Status** | Last updated |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Anveshan | Head of Ops | 2 Sep | Email | `Yet to respond` ▾ | 2 Sep |
| FOODHAK | Brand Mktg Mgr | 28 Aug | Rhea (referral) | `Awaiting round 2` ▾ | 11 Sep |
| Confidential | AD, P&C | 20 Aug | Job link | `Rejected` ▾ | 5 Sep |

**Status is one dropdown, seven values**, chosen so a candidate never has to think:

`Yet to respond` → `In review` → `Interview scheduled` → `Awaiting next round` → `Offer` · `Rejected` · `No response`

One tap changes it. No save button, no modal, no page reload.

**The one nudge that exists:** any row untouched for 14 days shows a soft amber dot and a single line at the top of the sheet — *"3 applications haven't been updated in a while."* No email, no blocking, no penalty. The sheet nags gently by looking incomplete.

### Sheet 3 — My posts *(posters only)*

| Role | Company | Posted | Applicants | Status |
| :-- | :-- | :-- | :-- | :-- |
| Head of Ops | Anveshan | 2 Sep | **9** | `Open` ▾ |

Expanding a row lists the applicants — name, batch, programme, LinkedIn link, and their self-reported status. This is the payoff that pulls posters off WhatsApp: they finally see that nine people applied and two got calls.

`Status` is the poster's own dropdown: `Open` · `Filled` · `Not sure`. A post with no update in 30 days greys out and drops to the bottom. No auto-archive in Lite — just visible ageing.

---

# 7. Data — five tables

`member` (google_sub, email, name, batch, programme, linkedin_url, known_by, verified_by `domain|admin`, status `pending|verified|rejected`, is_admin)

`job_post` (poster_id, title, company_name, is_confidential, confidential_descriptor, function, location, is_remote, exp_min, exp_max, comp_text, apply_method, apply_value, jd_url, note, **connection** `hiring|works_here|knows_contact|forwarded`, raw_paste, posted_at, post_status `open|filled|unsure`, last_confirmed_at)

`application` (job_post_id, member_id, applied_at, status, status_updated_at)

`notification` (member_id, kind, body, link, read_at, **pushed_at**, *emailed_at — column reserved, unused in Lite*)

`push_subscription` (member_id, endpoint, keys, created_at)

`report` (job_post_id, reporter_id, reason, at)

`verification_case` — folded into `member` for Lite; a separate table only once there are appeals.

---

# 8. Build order

| Step | Ships | You can demo |
| :-- | :-- | :-- |
| 1 | Google login, astra auto-verify, verification form, admin queue | "Only XLRI people get in" |
| 2 | Post a job (typed form), job board sheet, filters | "Here's every role, in one table" |
| 3 | Apply + My applications sheet with inline status | "Here's everything I've applied to and where it stands" |
| 4 | My posts sheet with applicant list | "Partho, nine people applied to yours" |
| 5 | Bell notifications, browser push, report link, paste-to-fill | "It tells you when something happens" |

Steps 1–3 are the demo that decides whether anyone uses this. Steps 4–5 are what makes them come back. Paste-to-fill is last on purpose — it is the best feature and the only one that can slip without blocking a launch, because six short fields can be typed.

---

# 9. What Lite deliberately does not do

No alumni directory. No searching for people. No messaging. No email. No resumes stored. No poster vetting. No automatic status — you tell it, it remembers. No promise that any application goes anywhere.

It answers two questions well: **what roles are going around right now, and where does everything I applied to stand.**
