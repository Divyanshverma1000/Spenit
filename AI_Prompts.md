# AI Build Prompts
### Stage-by-stage prompts for driving development in Cursor / Trae / Antigravity / Claude — plus the context-loading prompt used to resume work in a new tool or a new chat

This document exists because you're building on **free-tier AI IDE limits**,
which means you will run out of quota mid-stage and have to switch tools or
open a fresh chat. The two things that make that safe are:

1. **`ProgressTracker.md` is always updated at the end of every session** — it's
   the single source of truth for "what stage are we at, what's done, what's
   next."
2. **The Context-Loading Prompt below is pasted first, every single time**, in
   any new AI chat/tool, before any stage prompt. It forces the AI to read the
   other four docs and the tracker before touching code, so it never guesses at
   decisions that were already made.

**Rule for every stage prompt below:** each one explicitly tells the AI to
consult `Architecture.md` and `DB_Design.md` for exact specifics rather than
inventing its own schema/API shape, and to update `ProgressTracker.md`'s session
log before ending the session. Don't skip that instruction when you paste a
prompt — it's what keeps the docs and the code from drifting apart.

---

## 0. How To Use This File

**Every new AI chat/tool session, in this order:**

1. Paste the **Context-Loading Prompt** (§1 below) as the very first message.
2. Let the AI read the docs and confirm back to you what stage it thinks it's
   resuming and why (it should cite `ProgressTracker.md`'s last session log
   entry).
3. Paste the **Stage Prompt** for the current stage (§2 onward). If you're
   mid-stage (not starting fresh), say so explicitly — e.g. "we're mid-Stage 4,
   the balance function is done, settlement caching isn't" — so the AI doesn't
   redo finished work.
4. Work the stage to its Definition of Done.
5. Before closing the session (even if the stage isn't finished), paste the
   **End-of-Session Prompt** (§10) to force the `ProgressTracker.md` update.

Never start coding in a new tool without step 1. This is the entire point of
this document existing — an AI with no memory of the last session will
otherwise happily reinvent a schema decision that was already made and
documented.

---

## 1. Context-Loading Prompt (paste this first, every new chat/tool)

```
You are resuming work on an existing project. Do NOT write any code or make
any architectural decisions until you have done the following, in order:

1. Read these five files in the project root, in this order:
   - ProductDetailIDEA.md   (the "why" — product thesis and hard constraints)
   - Architecture.md        (the "how" — tech stack and every technical decision)
   - DB_Design.md            (the "what, exactly" — full schema, all versions)
   - Usecase_Flow.md         (real scenarios each feature must satisfy)
   - ProgressTracker.md      (the living log — what's actually built so far)

2. From ProgressTracker.md, find the most recent Session Log entry and tell me:
   - Which stage is currently IN PROGRESS or the next one that is NOT STARTED
   - What that entry says was done, what's left, and what the "next session
     should start with" line says
   - Any open items under "Deviations / Decisions Needed" that were flagged for
     me to resolve — surface these to me BEFORE proceeding, don't silently
     decide them yourself

3. Confirm back to me, in plain language, your understanding of:
   - What stage we're resuming
   - What's already built and working (don't rebuild it)
   - What the immediate next task is

4. Do not deviate from decisions already documented in Architecture.md or
   DB_Design.md. If something you're about to build seems to require a
   deviation (a new table, a changed API contract, a different library than
   specified), STOP and flag it to me explicitly instead of quietly doing it
   your own way. This matters more than moving fast.

5. Wait for my confirmation or my next instruction (the specific stage prompt)
   before writing any code.
```

---

## 2. Stage 0 — Repo & Environment Setup

```
Read Architecture.md §1 (tech stack table) and ProgressTracker.md's Stage 0
section before starting.

Goal: a working local dev environment, zero features yet.

Do the following:
1. Initialize a Next.js project (App Router, TypeScript, Tailwind CSS) for the
   frontend.
2. Initialize a Node.js + Express + TypeScript project for the backend.
3. Decide and clearly document (in a top-level README.md) whether this is a
   monorepo (e.g. /frontend + /backend folders in one repo) or two separate
   repos. Default to a monorepo with /frontend and /backend folders unless I
   tell you otherwise — it's simpler to manage on free-tier tooling.
4. Set up Postgres and Redis for local development (docker-compose is fine if
   Docker is available, otherwise document the manual local install steps).
5. Create a `.env.example` file in both /frontend and /backend documenting every
   required environment variable (DB connection string, Redis URL, JWT secret,
   Google OAuth client ID/secret placeholders, Groq API key placeholder) —
   never commit an actual .env with real secrets.
6. Build a single `GET /health` endpoint on the backend that returns
   `{ status: "ok" }`, and a simple frontend page/button that calls it and
   displays the result, to prove frontend-to-backend connectivity.
7. Move the five root docs (ProductDetailIDEA.md, Architecture.md, DB_Design.md,
   Usecase_Flow.md, ProgressTracker.md) and this AI_Prompts.md file into the
   repo root if they aren't already there.

Definition of Done (do not mark this stage DONE in ProgressTracker.md until all
of these are true):
- [ ] `npm run dev` (or documented equivalent) starts frontend and backend
      locally without errors
- [ ] Frontend successfully calls the backend health-check endpoint and shows
      the result
- [ ] Postgres and Redis are both reachable from the backend locally
- [ ] `.env.example` exists in both projects and is fully documented

When done (or when you stop for the session regardless of completion), update
ProgressTracker.md's Stage 0 status and add a Session Log entry per its
template. Don't skip this even if the stage isn't fully finished.
```

---

## 3. Stage 1 — Database & Auth Foundation

```
Read Architecture.md §1, §4, §10 and DB_Design.md §1, §2, and §10 (v0 migration
scope) before starting. Do not invent a schema — DB_Design.md §10 lists exactly
which seven tables the v0 migration creates: User, Group, GroupMember, Expense,
ExpensePayer, ExpenseSplit, Settlement. Use the exact column definitions given
in DB_Design.md §2–§5 for those tables, including the indexes listed in
DB_Design.md §8.

Goal: the v0 schema exists in Postgres, and Google sign-in works end to end.

Do the following:
1. Set up a migration tool (Prisma, Drizzle, or raw SQL migrations — pick
   whichever you're most reliable with, but document the choice) and create the
   v0 migration exactly per DB_Design.md §10, including all indexes from §8.
2. Implement Google OAuth sign-in on the backend: verify the Google ID token,
   look up or create a User row. On creation, auto-generate `username` from the
   Google profile's given name using the collision rule in DB_Design.md §2
   (firstname -> firstname2 on collision) — this must be a real collision check
   against the database, not a random suffix.
3. Issue a short-lived JWT access token plus a refresh token stored as an
   httpOnly cookie (never localStorage), per Architecture.md §10. The backend
   must remain fully stateless — no server-side session store, per
   Architecture.md §4.
4. Build a basic authenticated profile screen on the frontend showing the
   signed-in user's name, username, and avatar, calling a protected
   `GET /users/me` endpoint as proof the JWT auth actually protects a route.

Definition of Done:
- [ ] All seven v0 tables exist in Postgres with the exact constraints and
      indexes from DB_Design.md
- [ ] A new user can sign in with Google and a User row is created with a
      correctly auto-generated, collision-safe username
- [ ] JWT auth correctly protects GET /users/me (rejects an unauthenticated or
      invalid-token request)
- [ ] No in-memory session state exists anywhere in the backend

Update ProgressTracker.md's Stage 1 status and Session Log entry before ending
the session, following its template exactly, including any deviations you had
to make and why.
```

---

## 4. Stage 2 — Groups: Create, Join via Link/QR

```
Read Usecase_Flow.md Scenario A §1 and Scenario C, and DB_Design.md §3 before
starting. The entire trust model is "whoever has the link/QR can join" — there
is NO friend-search, NO friend-request flow, and NO Friendship table anywhere
in this project, by deliberate design. If you find yourself wanting to add a
user-search-by-name feature "for convenience," stop — that's explicitly cut,
see Usecase_Flow.md Scenario C for the full reasoning.

Goal: a user can create a group, get a shareable link + QR code, and a second
user can join using only that link, with zero search/friend-request steps.

Do the following:
1. Build `POST /groups` — creates a Group row (per DB_Design.md §3 schema),
   generates a unique `invite_token`, sets `created_by` to the authenticated
   user, and automatically adds that user as a GroupMember with role 'admin'.
2. Build a group-preview page at the invite-link route (e.g. `/g/:token`) that
   shows the group name and current member count, with a "Join" button —
   visible even to a user who hasn't signed in yet, prompting Google sign-in
   first if needed, then joining.
3. Build `POST /groups/:id/join` (or equivalent token-based join endpoint) that
   adds a GroupMember row for the authenticated user.
4. Generate a QR code for the invite link on the frontend (any client-side QR
   library is fine) shown alongside the shareable link on the group's page.
5. Build a group list screen showing every group the signed-in user belongs to.

Definition of Done:
- [ ] A user can create a group and immediately get both a shareable link and a
      QR code for it
- [ ] A second user, given only the link (no prior relationship in the system),
      can sign in and land in the group with no search or request/accept step
- [ ] Confirm by grepping the codebase: no Friendship table, no friend-search
      endpoint, no friend-request endpoint exists anywhere

Update ProgressTracker.md's Stage 2 status and Session Log entry before ending
the session.
```

---

## 5. Stage 3 — Manual Expense Entry (Equal & Exact Splits)

```
Read Architecture.md §3 (balances are always derived, never stored), §9 (API
idempotency), and DB_Design.md §4 (Expense/ExpensePayer/ExpenseSplit tables)
before starting. This stage is fully manual — no AI involvement at all. The
manual form you build here becomes the SAME component the AI confirm-card
pre-fills in Stage 6, so build it as a clean, reusable, controlled form now.

Goal: the core money-in path works end to end, manually, supporting multi-payer
and both equal and exact splits.

Do the following:
1. Build `POST /expenses` accepting: description, amount, currency (default
   'INR'), split_type ('equal' | 'exact' for v0), an array of payers
   (user_id + amount_paid), and an array of participants (user_id + share info
   depending on split_type). Write the corresponding ExpensePayer and
   ExpenseSplit rows.
2. Server-side validation: reject the request with a clear error if
   sum(ExpensePayer.amount_paid) != Expense.amount, or if
   sum(ExpenseSplit.share_amount) != Expense.amount. For 'equal' split_type,
   compute ExpenseSplit.share_amount server-side by dividing evenly among the
   selected participants (handle remainder cents deterministically, e.g. give
   the extra cent(s) to the first participant(s) in a stable order).
3. Add idempotency key support to POST /expenses per Architecture.md §9 — accept
   an `Idempotency-Key` header and prevent duplicate expense creation on retry.
4. Build the manual add-expense form UI: amount field, payer selector
   (supporting multiple payers with amounts), participant multi-select, and a
   split-type toggle (Equal / Exact) that changes the input fields shown
   accordingly.
5. Support soft-delete on Expense (deleted_at) — never a hard delete, per
   DB_Design.md §1.

Definition of Done:
- [ ] A user can add an expense with an equal split among any subset of group
      members and the amounts are computed correctly server-side
- [ ] A user can add an expense with exact custom amounts per participant
- [ ] A multi-payer expense (two people paid different amounts, split among
      five participants) saves correctly
- [ ] The backend rejects a malformed split (amounts that don't sum correctly)
      with a clear, specific error message
- [ ] Retrying the same POST /expenses request with the same Idempotency-Key
      does not create a duplicate expense

Update ProgressTracker.md's Stage 3 status and Session Log entry before ending
the session.
```

---

## 6. Stage 4 — Balance Engine & Debt Simplification

```
Read Architecture.md §3 and §7 IN FULL before writing a single line here — this
is the single most important stage in the whole v0 build, it's the actual
product differentiator. Also read ProductDetailIDEA.md §3 ("net balance first,
never a raw ledger as default") and Usecase_Flow.md Scenario A §5–§6 for what
the finished screens must look and feel like.

Goal: a correct, well-tested, cached balance and debt-simplification system,
surfaced as the app's core screen.

Do the following:
1. Write a pure, isolated, unit-tested function `computeNetBalance(userId,
   groupId | null, allExpenseData, allSettlementData)` implementing exactly the
   formula in Architecture.md §3:
   net_balance = sum(owed to them via ExpenseSplit as payer)
               - sum(they owe via ExpenseSplit as participant)
               - net effect of CONFIRMED Settlements only (pending/rejected
                 settlements must NOT affect the balance)
   This function must take data as arguments and have zero DB calls inside it
   — no side effects, fully testable in isolation.
2. Write a pure, isolated, unit-tested function implementing the min-cash-flow
   debt-simplification algorithm from Architecture.md §7: given a set of net
   balances within a group, repeatedly settle the largest creditor against the
   largest debtor, returning a list of {from, to, amount} transfers. No DB
   calls, no side effects here either.
3. Build `GET /users/me/balance` (cross-group total, one number) and
   `GET /groups/:id/balance` (per-group, breaks down per-person) endpoints that
   call these functions against real data pulled from Postgres.
4. Add Redis caching to both balance endpoints. Invalidate the relevant cache
   key on every write that affects balance: new expense created, new
   settlement created, settlement confirmed. Be precise about invalidation
   scope — invalidate per-group and per-user-cross-group keys as appropriate,
   don't over-invalidate the entire cache on every write.
5. Build the balance screen UI per ProductDetailIDEA.md §3's rule: show ONE
   number per person/group by default (net, single direction — "Aman owes you
   ₹600" not "you owe Aman -₹0 and Aman owes you ₹600"), with a tap-through to
   the underlying transaction list as an optional drill-down, never the default
   view.
6. Build the home dashboard UI: one correct combined net-owed/net-owing number
   rolled up across every group and every 1:1, exactly like
   Usecase_Flow.md Scenario A §5 describes.

Definition of Done:
- [ ] computeNetBalance has unit tests covering: multi-payer expenses,
      multi-participant unequal splits, and settlement-adjusted balances
      (confirmed settlements reduce the balance correctly; pending ones do not)
- [ ] The debt-simplification function has unit tests confirming it produces
      the mathematically minimum number of transfers for at least 3 different
      test scenarios (including one where naive settling would produce more
      transfers than necessary)
- [ ] The balance screen shows one number per person/group, never both
      directions simultaneously
- [ ] The home dashboard shows one correct combined number across all of the
      test user's groups
- [ ] Manually verified: add a new expense, confirm the balance screen updates
      immediately (cache invalidation actually works, not just on cold cache)

Update ProgressTracker.md's Stage 4 status and Session Log entry before ending
the session — this stage is likely to span multiple sessions, so be precise
about exactly which of the two functions/which endpoints are done vs pending.
```

---

## 7. Stage 5 — Settlement Flow (UPI Deep Links + Two-Way Confirmation)

```
Read Architecture.md §7 and DB_Design.md §5 (Settlement table) before starting,
and Usecase_Flow.md Scenario A §6 for the exact UX this stage must produce.
The two-way confirmation requirement is not optional — a balance must NEVER
clear to zero based on only one party's action.

Goal: the full settle-up loop, from debt-simplification through UPI payment
through mutual confirmation.

Do the following:
1. Build `POST /settlements` — creates a Settlement row with status 'pending',
   initiated_by set to the authenticated user, method defaulting to 'upi'
   (but accepting 'cash' | 'other' for the manual-log path).
2. Build `POST /settlements/:id/confirm` — settable ONLY by the settlement's
   `to_user` (the person who was owed money, confirming they received it),
   setting status='confirmed', confirmed_by, confirmed_at. Until this happens,
   Stage 4's balance computation must continue treating the debt as
   outstanding — verify this against the computeNetBalance function from
   Stage 4, don't special-case it in the UI only.
3. Build UPI deep link generation: `upi://pay?pa=<upi_id>&pn=<name>&am=<amount>
   &cu=INR` (or the correct current UPI deep-link spec — verify exact query
   param names) pre-filled with the exact settlement amount, pointing at the
   recipient's `upi_id` from their User row.
4. Build the "Settle Up" UI flow: run the debt-simplification function from
   Stage 4 for the group, show the plain-language explanation (e.g. "Instead
   of 4 payments, only 2 are needed"), let the user tap a specific transfer to
   pay, generating the UPI deep link and calling POST /settlements.
5. Build the manual "log a cash settlement" path: same POST /settlements
   endpoint with method='cash', still requiring the other party's confirmation
   through the same POST /settlements/:id/confirm flow — do not build a
   separate, unconfirmed "just mark as paid" shortcut anywhere.

Definition of Done:
- [ ] Initiating a settlement generates a correct UPI deep link with the right
      pre-filled amount
- [ ] Balance does NOT change after initiation alone — verify by checking
      GET /groups/:id/balance before and after POST /settlements (should be
      unchanged)
- [ ] After the recipient confirms via POST /settlements/:id/confirm, the
      balance correctly clears — verify by checking the balance endpoint again
- [ ] A user can log a manual cash settlement and have the other party confirm
      it through the identical confirmation flow
- [ ] The debt-simplification explanation is shown to the user before they
      commit to a specific transfer

Update ProgressTracker.md's Stage 5 status and Session Log entry before ending
the session.
```

---

## 8. Stage 6 — AI Natural-Language Expense Entry (Groq)

```
Read ProductDetailIDEA.md §5 and Architecture.md §2 and §6 IN FULL before
starting. The core rule that governs this entire stage: THE AI NEVER WRITES TO
THE DATABASE DIRECTLY, AND NEVER INVENTS A NUMBER. It only produces a draft
that populates the exact same manual-entry form component built in Stage 3 —
the user always sees an editable confirm-card and must explicitly confirm
before anything is saved. If your implementation has the AI call a save/commit
endpoint directly, that's wrong — stop and rebuild it as "AI drafts, existing
manual-entry POST /expenses commits."

Goal: the one AI feature in v0 — natural-language expense entry — working
reliably, with a graceful, non-blocking fallback on failure.

Do the following:
1. Build the `AIProvider` interface exactly as specified in Architecture.md
   §6's TypeScript interface. Implement only `parseExpenseText` for this
   stage — stub the other methods (parseReceiptText,
   phraseSettlementExplanation, phraseSpendSummary, answerLedgerQuery) so the
   interface shape is correct now even though they're unused until later
   tiers.
2. Integrate Groq for `parseExpenseText(input, groupContext)`: send the typed
   or spoken text plus the group's member list (id, name, username) as
   context, and get back structured JSON: amount, payer(s), participants,
   split type. The prompt must instruct the model to disambiguate participants
   against the provided groupContext by username when names collide (e.g. two
   "Prashant"s), per DB_Design.md §2's disambiguation rule and
   Usecase_Flow.md Scenario A §2.
3. Build the confirm-card UI: the Stage 3 manual-entry form component,
   pre-filled with the AI's parsed draft, fully editable before the user taps
   confirm. Confirming calls the exact same POST /expenses endpoint from
   Stage 3 — do not create a separate save path for AI-originated expenses.
4. Build the fallback path: if the Groq call fails, times out, or returns
   malformed JSON, drop straight to the Stage 3 manual form (empty, or
   partially pre-filled with anything trivially extractable like a number
   found in the raw text) — never show a hard error or a broken screen to the
   user. This must be tested by actually simulating a failure (e.g.
   temporarily using an invalid API key), not just assumed to work.
5. Add a Redis-backed usage counter logging every Groq call: prompt size,
   latency, success/failure, per Architecture.md §6. At v0 scale this doesn't
   need to gate/throttle anything yet — it's for visibility into whether a
   paid tier or second provider will be needed later.

Definition of Done:
- [ ] Typing "Dinner 900, Rahul paid, split among 5" (adjusted to real test
      group member names) produces a correct pre-filled confirm card matching
      the input
- [ ] A test group with two members sharing a first name correctly
      disambiguates them in the parsed output (via username), not just by
      whichever matched first
- [ ] Editing a mis-parsed field on the confirm-card before confirming behaves
      identically to using the plain manual form (because it IS the manual
      form)
- [ ] Simulating a Groq failure (bad API key, or forced timeout) correctly
      falls back to the manual form with no hard error or blank screen shown
- [ ] Every Groq call (success or failure) is logged with prompt size,
      latency, and outcome, in structured logs or a simple table

Update ProgressTracker.md's Stage 6 status and Session Log entry before ending
the session.
```

---

## 9. Stage 7 — Web Push Notifications

```
Read ProductDetailIDEA.md §6 (iOS push constraint) before starting. This stage
is deliberately simple — no smart/contextual reminder logic (that's an
explicit Tier 1 cut per ProductDetailIDEA.md, do not build it now).

Goal: new expense, settlement requested, and settlement confirmed each
correctly trigger a push notification to relevant group members.

Do the following:
1. Implement web push subscription: service worker registration on the
   frontend, and a permission-request prompt shown at a sensible moment in the
   flow (e.g. after a user's first successful group join or first expense —
   NOT immediately on page load, which iOS/Android users reflexively dismiss).
2. Store push subscriptions server-side, associated with the User row.
3. Trigger a push notification in these three cases only:
   - A new expense is added to a group (notify other group members, not the
     person who added it)
   - A settlement is initiated where the authenticated user is the `to_user`
     (they're being asked to confirm they received payment)
   - A settlement is confirmed where the authenticated user is the
     `from_user` (their payment was confirmed received)
4. If the client is iOS Safari and the app isn't installed to the home screen,
   the notification permission prompt won't work (iOS 16.4+ requirement) —
   detect this case and show an in-app message explaining "install to home
   screen to get notifications" instead of silently failing.

Definition of Done:
- [ ] A user receives a push notification when another group member adds an
      expense
- [ ] A user receives a push notification when a settlement is requested of
      them, and a separate one when their own settlement is confirmed by the
      other party
- [ ] The permission prompt appears at a sensible point in the flow, not on
      first page load
- [ ] The iOS "install to home screen" constraint is handled gracefully, not
      silently

Update ProgressTracker.md's Stage 7 status and Session Log entry before ending
the session.
```

---

## 10. Stage 8 — PWA Polish & Real Device Testing → v0 Launch

```
Read ProductDetailIDEA.md §8's "done" criteria and ProgressTracker.md's Stage
8 Definition of Done before starting — this stage's checklist IS the v0 launch
checklist, treat it as the real bar, not a formality.

Goal: ship v0 to the actual 10-20 person friend group it was built for.

Do the following:
1. Finalize the web app manifest and service worker: proper icon set, splash
   screen, correct display mode ('standalone'), theme color.
2. Do a full mobile-first responsive pass across every screen built in Stages
   2-7 — test at minimum at a small phone width (375px) and a larger phone
   width (428px).
3. Handle the offline case gracefully at a basic level: the app must not
   hard-crash with no network connection (e.g. show a clear "you're offline"
   state rather than a blank screen or console error) — full offline queuing
   of actions is out of scope for v0 unless Architecture.md explicitly says
   otherwise; check before assuming either way.
4. Add an in-app note about the iOS install-to-home-screen requirement for
   notifications, shown at a sensible point (e.g. during onboarding for iOS
   users), per ProductDetailIDEA.md §6.
5. Walk through the entire v0 flow yourself end to end before real device
   testing: create group -> invite -> join -> add expense via NL text -> add
   expense manually -> check balance screen -> check home dashboard -> settle
   up -> confirm settlement -> check push notifications fired.

Definition of Done (this is also "v0 is done" — do not mark it DONE lightly):
- [ ] All friends in the target group can create/join a group via link in
      under 10 seconds
- [ ] Adding an expense via typed natural language works correctly more often
      than it needs manual correction, in real use (not just your own test
      cases)
- [ ] The net balance number is trusted enough that people don't feel the need
      to double-check it against the transaction list
- [ ] Settling up via UPI deep link + confirmation is actually used, instead
      of people reverting to "just pay me directly and forget to log it"
- [ ] The app installs cleanly to the home screen on at least one real iPhone
      and one real Android phone

When every box above is checked (based on real usage, not just code review),
update the "Overall status" line at the very top of ProgressTracker.md to
reflect v0 launch, and add a final Session Log entry summarizing the launch.
Stages 9+ remain provisional until real usage feedback comes in, per
ProductDetailIDEA.md §8 — do not start expanding Stage 9+ into detailed
sub-stages until that feedback exists.
```

---

## 11. End-of-Session Prompt (paste this before closing any session, finished stage or not)

```
Before we end this session, update ProgressTracker.md:

1. Update the current stage's status marker at the top of its section
   (NOT STARTED / IN PROGRESS / DONE) — only mark DONE if every box in that
   stage's Definition of Done is actually checked and verified, not assumed.
2. Add a new Session Log entry at the TOP of the Session Log section (newest
   first), following the template in ProgressTracker.md exactly:
   - Stage worked on
   - Status change
   - What was done (be specific — file names, endpoints, functions, not vague
     summaries)
   - What's left in this stage
   - Deviations / Decisions Needed (anything that conflicted with
     Architecture.md, DB_Design.md, or this file, or any judgment call I
     should review — write "None" if there genuinely isn't anything)
   - Next session should start with (a specific, concrete next action, not
     "continue Stage N")

Do not close the session until this is done, even if we're stopping mid-task.
```

---

## 12. Stage 9+ (v1 and Beyond) — Expansion Prompt

Once v0 is launched and real feedback comes in, use this prompt to expand any
provisional Stage 9+ item from `ProgressTracker.md` into the same level of
detail as Stages 0-8 above, before starting it:

```
Read ProgressTracker.md's Stage 9+ list, Architecture.md, and DB_Design.md's
relevant [V1 — PLANNED] / [TIER 1 — PLANNED] sections for the stage I name
below. Expand that single stage into the same format as Stages 0-8 in
AI_Prompts.md: a Goal, a numbered Scope/Do-the-following list referencing exact
schema/API details from DB_Design.md and Architecture.md (don't invent new
ones — if the doc doesn't have the detail needed, flag that gap to me instead
of guessing), and a checkbox Definition of Done. Write the expanded stage back
into ProgressTracker.md in place of the one-line provisional entry, then stop
and wait for me to confirm before you start building it.

Stage to expand: [NAME THE STAGE, e.g. "Stage 9: Email/OTP auth"]
```

---

## Cross-Reference

- Product reasoning behind every constraint referenced in these prompts:
  `ProductDetailIDEA.md`
- Technical decisions these prompts must not deviate from:
  `Architecture.md`
- Exact schema every stage's data model must match: `DB_Design.md`
- Concrete scenarios each stage's UX must satisfy: `Usecase_Flow.md`
- What's actually been built, updated after every session: `ProgressTracker.md`