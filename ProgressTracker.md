# Progress Tracker
### The living log — updated by the AI at the end of every work session. This file is the source of truth for "what stage are we at, and what's actually done."

**Instructions for the AI (read this before doing anything else in this file):**
- Never mark a stage `DONE` unless the code actually builds/runs and satisfies its
  "Definition of Done" checklist below.
- At the end of every session, fill in the **Session Log** entry at the bottom
  with: what was done, what's left in the current stage, any deviations from the
  plan in `AI_Prompts.md`/`Architecture.md`/`DB_Design.md` (and why), and exactly
  what the next session should start with.
- If a decision made during a session conflicts with something in
  `Architecture.md` or `DB_Design.md`, do not silently proceed — flag it clearly
  in the session log under "Deviations / Decisions Needed" so the human can
  resolve it before the next session continues.
- Update the stage status marker (`NOT STARTED` / `IN PROGRESS` / `DONE`) for the
  current stage at the top of its section every time you touch it.

---

## How to Read This Document

Stages 1–8 build **v0 ("Friends")** — a real, working PWA for a 10–20 person
friend group, per `ProductDetailIDEA.md` §8. Stages 9+ build v1 and beyond. Stage
numbers beyond 8 are provisional and will be refined once v0 ships and real usage
feedback comes in — that's by design (see `ProductDetailIDEA.md` §8: "that real
usage — not more features — is what tells you what to build next").

**Overall status:** `NOT STARTED` — this tracker is a fresh template, project has
not begun.

---

## Stage 0 — Repo & Environment Setup
**Status:** NOT STARTED

**Goal:** a working local dev environment, no features yet.

**Scope:**
- Initialize Next.js (App Router, TypeScript, Tailwind) project structure
- Initialize Express backend project structure (separate `/backend` folder or
  monorepo — decide and document the choice here once made)
- Postgres running locally (or a dev instance), Redis running locally
- `.env` structure defined (never commit secrets — `.env.example` committed
  instead)
- Root-level docs (`ProductDetailIDEA.md`, `Architecture.md`, `DB_Design.md`,
  `Usecase_Flow.md`, `AI_Prompts.md`, `ProgressTracker.md`) placed in repo root
- Basic health-check endpoint (`GET /health`) on the backend, confirmed reachable
  from the Next.js frontend

**Definition of Done:**
- [ ] `npm run dev` (or equivalent) starts frontend and backend locally without
      errors
- [ ] Frontend can successfully call the backend health-check endpoint
- [ ] Postgres and Redis are both reachable from the backend locally
- [ ] `.env.example` exists and is documented

---

## Stage 1 — Database & Auth Foundation
**Status:** NOT STARTED

**Goal:** the v0 schema exists and Google sign-in works end to end.

**Scope:**
- Create the v0 migration exactly per `DB_Design.md` §10 — `User`, `Group`,
  `GroupMember`, `Expense`, `ExpensePayer`, `ExpenseSplit`, `Settlement` — plus
  the indexes in `DB_Design.md` §8
- Google OAuth sign-in flow (backend verifies Google token, creates/looks up
  `User` row, auto-generates `username` per `DB_Design.md` §2)
- JWT access token + refresh cookie issuance, per `Architecture.md` §4/§10
- Basic profile screen showing the signed-in user's `name`/`username`/avatar

**Definition of Done:**
- [ ] All v0 tables exist in Postgres with correct constraints/indexes
- [ ] A new user can sign in with Google and a `User` row is created with a
      correctly auto-generated, collision-safe `username`
- [ ] JWT auth protects at least one test endpoint
- [ ] Backend has zero in-memory session state (stateless, per
      `Architecture.md` §4)

---

## Stage 2 — Groups: Create, Join via Link/QR
**Status:** NOT STARTED

**Goal:** the group-formation flow from `Usecase_Flow.md` Scenario A §1 works.

**Scope:**
- `POST /groups` (create group, generates `invite_token`)
- Group preview page at the invite-link route (shows group name, member count,
  join button)
- `POST /groups/:id/join` (adds `GroupMember` row)
- QR code generation for the invite link (can be client-side, e.g. a QR library)
- Group list screen (shows all groups the signed-in user belongs to)

**Definition of Done:**
- [ ] A user can create a group and receive a shareable link + QR code
- [ ] A second user, given only the link, can sign in and join the group with no
      search/friend-request step anywhere in the flow
- [ ] No `Friendship` table or friend-search endpoint exists anywhere (per
      `DB_Design.md` §9 / `Usecase_Flow.md` Scenario C)

---

## Stage 3 — Manual Expense Entry (Equal & Exact Splits)
**Status:** NOT STARTED

**Goal:** the core money-in path works, fully manual, before any AI is involved.

**Scope:**
- `POST /expenses` — supports multi-payer (`ExpensePayer` rows) and both
  `split_type = 'equal'` and `'exact'` (writing `ExpenseSplit` rows accordingly)
- Manual add-expense form UI: amount, payer(s), participants, split type toggle
- Validation: `sum(ExpensePayer.amount_paid) == Expense.amount`,
  `sum(ExpenseSplit.share_amount) == Expense.amount`
- Idempotency key support on `POST /expenses` (per `Architecture.md` §9), even
  though v0 concurrency risk is low

**Definition of Done:**
- [ ] A user can add an expense with equal split among any subset of group
      members
- [ ] A user can add an expense with exact custom amounts per participant
- [ ] Multi-payer expenses (two people paid, split among five) work correctly
- [ ] Backend rejects a malformed split (amounts don't sum correctly) with a
      clear error

---

## Stage 4 — Balance Engine & Debt Simplification
**Status:** NOT STARTED

**Goal:** the actual differentiator screen — this is the single most important
stage in v0.

**Scope:**
- Pure, isolated, unit-tested balance computation function per
  `Architecture.md` §3 (derived from `Expense`+`ExpensePayer`+`ExpenseSplit`+
  `Settlement`, never stored)
- Pure, isolated, unit-tested debt-simplification function per
  `Architecture.md` §7 (min-cash-flow graph reduction)
- `GET /users/me/balance` (cross-group total) and `GET /groups/:id/balance`
  (per-group, per-person) endpoints
- Redis caching on both balance endpoints, with invalidation on any write that
  affects balance (new expense, new/confirmed settlement) — per
  `Architecture.md` §4
- Balance screen UI: net-balance-first (single number, never both directions
  shown simultaneously — per `ProductDetailIDEA.md` §3), with drill-down to
  transaction list on tap
- Home dashboard UI: cross-group rolled-up single number

**Definition of Done:**
- [ ] Balance computation has unit tests covering multi-payer, multi-participant,
      and settlement-adjusted scenarios
- [ ] Debt-simplification has unit tests confirming it produces the minimum
      transfer count for a given set of net balances
- [ ] Balance screen shows one number per person/group by default, matching the
      "net, one direction" rule
- [ ] Home dashboard shows one correct combined number across all groups
- [ ] Redis cache correctly invalidates after a new expense or confirmed
      settlement (verify manually: add expense, confirm balance updates
      immediately)

---

## Stage 5 — Settlement Flow (UPI Deep Links + Two-Way Confirmation)
**Status:** NOT STARTED

**Goal:** the settle-up loop from `Usecase_Flow.md` Scenario A §6 works
end-to-end.

**Scope:**
- `POST /settlements` (status `'pending'`, `initiated_by` set)
- `POST /settlements/:id/confirm` (sets `status='confirmed'`, `confirmed_by`,
  `confirmed_at`) — only after this does the balance engine treat it as clearing
  the debt
- UPI deep link generation (`upi://pay?...` with amount pre-filled) for GPay/
  PhonePe/Paytm/BHIM
- "Settle Up" UI: runs debt-simplification, shows the plain-language explanation
  ("Instead of 4 payments, only 2 are needed"), lets the user tap through to pay
  and mark as paid
- Manual "log a cash settlement" path (method = `'cash'`/`'other'`), also
  requiring the other party's confirmation

**Definition of Done:**
- [ ] A settlement can be initiated, generates a correct UPI deep link with the
      right amount
- [ ] The other party can confirm, and only then does the balance actually clear
      to zero (verify: check balance before confirmation, confirm, check again)
- [ ] A user can log a manual cash settlement and have the other party confirm
      it the same way
- [ ] Debt-simplification result is shown with a plain-language explanation
      before the user commits to a specific settlement

---

## Stage 6 — AI Natural-Language Expense Entry (Groq)
**Status:** NOT STARTED

**Goal:** the one AI feature in v0, working with a graceful fallback.

**Scope:**
- `AIProvider` interface built per `Architecture.md` §6 (even though only
  `parseExpenseText` is implemented in v0 — the interface shape includes the
  later methods as documented, unimplemented/stubbed)
- Groq integration for `parseExpenseText`: typed/spoken text → structured draft
  (amount, payer, participants matched against `GroupMember`+`username`
  disambiguation, split type)
- Confirm-card UI: shows the AI's parsed draft as an editable form (using the
  *same* manual-entry form component from Stage 3 — pre-filled, not a separate
  UI) before the user commits
- Fallback: on Groq failure/timeout, drop straight to the empty/partially-filled
  manual form — never a hard error to the user (per `Usecase_Flow.md`
  Scenario D)
- Redis-backed Groq call counter (usage logging: prompt size, latency,
  success/failure) per `Architecture.md` §6

**Definition of Done:**
- [ ] Typing "Dinner 900, Rahul paid, split among 5" produces a correct
      pre-filled confirm card
- [ ] Editing a mis-parsed field before confirming works exactly like the manual
      form (because it *is* the manual form, pre-filled)
- [ ] Simulating a Groq failure (e.g. temporarily wrong API key) correctly falls
      back to the manual form with no hard error shown to the user
- [ ] Every Groq call is logged (prompt size, latency, success/failound) to
      structured logs or a simple table

---

## Stage 7 — Web Push Notifications
**Status:** NOT STARTED

**Goal:** new expense, settlement requested, settlement confirmed all notify
correctly.

**Scope:**
- Web push subscription flow (service worker registration, permission prompt at
  a sensible moment — not on first load)
- Notification triggers: new expense added to a group, settlement requested,
  settlement confirmed
- No smart/contextual reminder logic yet — that's Tier 1 (per
  `ProductDetailIDEA.md`'s explicit v0 cut list)

**Definition of Done:**
- [ ] A user receives a push notification when another group member adds an
      expense
- [ ] A user receives a push notification when a settlement is requested of them
      and when their settlement is confirmed
- [ ] Notification permission is requested at a sensible point in the flow, not
      immediately on page load

---

## Stage 8 — PWA Polish & Real Device Testing → **v0 Launch**
**Status:** NOT STARTED

**Goal:** ship v0 to the actual 10–20 person friend group.

**Scope:**
- Web app manifest + service worker finalized (installable icon, splash screen)
- Mobile-first responsive pass across every screen built in Stages 2–7
- Real installs tested on at least one real iPhone and one real Android phone
- Offline-tolerant basics: at minimum, the app doesn't hard-crash with no
  connection (full offline queueing is a later refinement, not a v0 blocker
  unless it was explicitly scoped in — check `Architecture.md` before assuming
  either way)
- iOS push constraint documented in-app if relevant (per
  `ProductDetailIDEA.md` §6 — install-to-home-screen requirement on iOS 16.4+)

**Definition of Done (this is also "v0 is done," per `ProductDetailIDEA.md` §8):**
- [ ] All 10–20 friends can create/join a group via link in under 10 seconds
- [ ] Adding an expense via typed natural language works correctly more often
      than it needs manual correction
- [ ] The net balance number is trusted enough that nobody feels the need to
      double check it against a transaction list
- [ ] Settling up via UPI deep link + confirmation actually gets used instead of
      people falling back to "just pay me directly and forget to log it"
- [ ] The app installs cleanly to the home screen on both iOS and Android phones
      in the group

**🎉 When Stage 8's Definition of Done is fully checked, v0 is launched. Update
the "Overall status" line at the top of this document, and treat Stages 9+ below
as provisional until real v0 usage feedback refines them (per
`ProductDetailIDEA.md` §8).**

---

## Stage 9+ — v1 and Beyond (Provisional — Refine After v0 Feedback)

These stages are intentionally left less granular than Stages 0–8. Once v0 is
live and real feedback comes in, break each of these into the same level of
Stage-N detail as above (goal / scope / definition of done) before starting them,
and insert those expanded stages here, renumbering as needed.

- **Stage 9 (v1):** Email/OTP auth added alongside Google sign-in
- **Stage 10 (v1):** Percentage & share-weighted splits
- **Stage 11 (v1):** Data export (CSV)
- **Stage 12 (v1):** Cross-group dashboard polish, v1 feature-complete → **v1
  launch**
- **Stage 13 (Tier 1):** Receipt scanning + OCR + itemized splits
  (`ExpenseItem`/`ExpenseItemAssignment` tables activate — see `DB_Design.md`
  §4)
- **Stage 14 (Tier 1):** Recurring expenses
- **Stage 15 (Tier 1):** Smart/contextual reminders
- **Stage 16 (Tier 1):** AI monthly spend insight summaries, smart categorization
  (`Category`/`MerchantCategoryCache` tables activate)
- **Stage 17 (Tier 1):** Multi-currency with live FX → **Tier 1 launch**
- **Stage 18+ (Tier 2):** Trip Mode (`TripWorkspace` and related tables
  activate), Subscription Sharing (`Subscription` table activates), College/Group
  Templates, conversational ledger assistant, expense timeline/feed view
- **Stage 25+ (Tier 3):** Pro subscription (`ProSubscription` table activates),
  donations, referral system (`Referral` table activates), group leaderboard.
  Business/restaurant mode is explicitly a separate product surface/spec, not a
  stage in this tracker (per `ProductDetailIDEA.md` §7).

---

## Session Log

*(Newest entries at the top. Each session's entry should be added by the AI at
the end of that session, following the template below.)*

### Template for each entry:
```
### Session [N] — [YYYY-MM-DD] — [AI tool used, e.g. Cursor / Antigravity / Claude]
**Stage worked on:** [stage number and name]
**Status change:** [e.g. "Stage 3: NOT STARTED -> IN PROGRESS"]

**What was done:**
- ...

**What's left in this stage:**
- ...

**Deviations / Decisions Needed:**
- [Anything that conflicted with Architecture.md/DB_Design.md/AI_Prompts.md, or
  any judgment call made that the human should review. Write "None" if none.]

**Next session should start with:**
- [Specific, concrete next action]
```

---

*(No sessions logged yet — this is a fresh project.)*