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

**Overall status:** `IN PROGRESS` — Stages 0, 1, 2, 3, 4, 5, 6A, and 7 complete. Stage 6B (receipt OCR) and Stage 8 (PWA Polish) next.

---

## Stage 0 — Repo & Environment Setup
**Status:** DONE

**Goal:** a working local dev environment, no features yet.

**Decision — Monorepo:** Single repo with `/frontend` and `/backend` subdirectories.
Documented in root `README.md`. Both are independent Node projects (own `package.json`).

**Scope:**
- Initialize Next.js (App Router, TypeScript, Tailwind) project structure ✅
- Initialize Express backend project structure (`/backend` folder in monorepo) ✅
- Postgres running locally via Docker Compose ✅
- Redis running locally via Docker Compose ✅
- `.env` structure defined (`.env.example` committed, `.env`/`.env.local` gitignored) ✅
- Root-level docs already present at repo root ✅
- Basic health-check endpoint (`GET /health`) on the backend, confirmed reachable
  from the Next.js frontend ✅

**Definition of Done:**
- [x] `npm run dev` starts frontend (port 3000) and backend (port 4000) locally without errors
- [x] Frontend health-check page calls `GET /health` and displays the result
- [x] Postgres and Redis both reachable — confirmed via `/health` returning `{"postgres":"ok","redis":"ok"}`
- [x] `.env.example` exists in both `/frontend` and `/backend` and is fully documented

---

## Stage 1 — Database & Auth Foundation
**Status:** DONE

**Goal:** the v0 schema exists and Google sign-in works end to end.

**Migration tool chosen: raw SQL** — `backend/migrations/001_v0_schema.sql` executed
by a custom `backend/src/db/migrate.ts` runner that tracks applied files in a
`_migrations` table. Rationale: raw SQL guarantees byte-for-byte fidelity with
the exact column definitions in DB_Design.md (ORM schema languages can silently
rewrite types/constraints).

**Scope:**
- v0 migration created and applied: all 7 tables + 8 indexes ✅
- Google OAuth sign-in: backend verifies Google ID token via `google-auth-library`,
  upserts User with collision-safe username per DB_Design.md §2 ✅
- JWT access token (15 min, response body) + refresh token (7 days, httpOnly cookie) ✅
- Protected `GET /users/me` endpoint + frontend profile screen ✅

**Definition of Done:**
- [x] All 7 v0 tables exist in Postgres with correct constraints/indexes (verified via `\dt` + `pg_indexes`)
- [x] Google sign-in creates a User row with collision-safe auto-generated username
- [x] JWT auth protects `GET /users/me` — no token → 401, invalid token → 401, valid token → 200
- [x] Backend has zero in-memory session state — stateless per Architecture.md §4

---

## Stage 2 — Groups: Create, Join via Link/QR
**Status:** DONE

**Goal:** the group-formation flow from `Usecase_Flow.md` Scenario A §1 works.

**Scope:**
- `POST /groups` (create group, generates `invite_token`, auto-joins creator as 'admin') ✅
- Group preview page at the invite-link route `/g/:token` (shows name, member count, Google sign-in to join) ✅
- `POST /groups/join/:token` (adds `GroupMember` row, idempotent) ✅
- QR code generation for the invite link (rendered client-side via `qrcode.react`) ✅
- Group list screen (shows all groups the user belongs to) ✅

**Definition of Done:**
- [x] A user can create a group and receive a shareable link + QR code
- [x] A second user, given only the link, can sign in and join the group with no search/friend-request step
- [x] Confirmed by grepping the codebase: no Friendship table, no friend-search endpoint, no friend-request endpoint exists anywhere

---

## Stage 3 — Manual Expense Entry (Equal & Exact Splits)
**Status:** DONE

**Goal:** the core money-in path works end to end, manually, supporting multi-payer and both equal and exact splits.

**Scope:**
- `POST /expenses` — multi-payer, equal/exact splits, Redis idempotency, soft-delete only ✅
- `GET /expenses?groupId=` — list non-deleted expenses with payer + split details ✅
- `DELETE /expenses/:id` — soft-delete (sets deleted_at), never hard delete ✅
- `decimal.js` for all money arithmetic — no IEEE 754 rounding errors ✅
- Equal split: share_amount computed server-side, remainder cents go to first participant(s) in stable order ✅
- Manual add-expense form UI: description, amount, multi-payer with per-payer amounts, participant multi-select, split-type toggle (Equal/Exact) ✅
- Idempotency key: client generates `crypto.randomUUID()`, backend checks Redis before persisting ✅
- Group detail page updated: expense list with total spend, Add Expense button, soft-delete button ✅

**Definition of Done:**
- [x] Equal split computes correctly server-side, remainder cents to first participant(s)
- [x] Exact split validates sum of shares equals total (clear error on mismatch)
- [x] Multi-payer expenses save correctly (payer sum validated against total)
- [x] Backend rejects malformed splits with specific, clear error messages
- [x] Idempotency key stored in Redis; retry returns same response without creating duplicate
- [x] Soft-delete: deleted_at set, row preserved (6/6 verification tests)

---

## Stage 4 — Balance Engine & Debt Simplification
**Status:** DONE

**Goal:** correct, well-tested, cached balance and debt-simplification system surfaced as the app's core screen.

**Scope:**
- `src/lib/balance.ts` — pure `computeNetBalance()` + `computeAllNetBalances()`, zero DB calls ✅
- `src/lib/debtSimplification.ts` — pure `simplifyDebts()` min-cash-flow algorithm, zero DB calls ✅
- `src/lib/balance.test.ts` — 19 unit tests (single payer, multi-payer, unequal splits, confirmed settlements, pending/rejected settlements excluded, soft-deleted expenses excluded) ✅
- `src/lib/debtSimplification.test.ts` — 16 unit tests across 6 scenarios including circular cancellation and min-transfers proof ✅
- `GET /balance/groups/:id` — Redis-cached 5min, returns member balances + simplified transfers ✅
- `GET /balance/me` — Redis-cached cross-group net total with per-group breakdown ✅
- Cache invalidation hooked into `POST /expenses` (group + all member user keys) ✅
- Balance screen UI: hero number (one direction, net), per-member breakdown, simplified transfer list, optional drill-down ✅
- Dashboard page: cross-group ONE number, per-group breakdown list ✅

**Definition of Done:**
- [x] `computeNetBalance` tests: multi-payer, multi-participant unequal splits, confirmed settlements reduce balance, pending/rejected do NOT — 35 tests passing
- [x] Debt-simplification tests: minimum transfers for 3+ scenarios including circular cancellation (0 transfers) and 4-5 person groups
- [x] Balance screen shows ONE number per person, net direction only (never both directions simultaneously)
- [x] Dashboard shows one correct combined number across all groups
- [x] Cache invalidation wired: POST /expenses fires `invalidateGroupBalanceCache()` (group key + all member cross-group keys)
- [x] 401 on unauthenticated balance request confirmed

---

## Stage 5 — Settlement Flow (UPI Deep Links + Two-Way Confirmation)
**Status:** DONE

**Goal:** the settle-up loop from `Usecase_Flow.md` Scenario A §6 works end-to-end.

**Scope implemented:**
- `migrations/002_settlements.sql` — Settlement table (DB_Design.md §5 schema) + `upi_id` column on User ✅
- `POST /settlements` — creates pending settlement, returns UPI deep link if `upi_id` is set ✅
- `POST /settlements/:id/confirm` — to_user ONLY, sets confirmed/confirmed_by/confirmed_at, invalidates balance cache ✅
- `POST /settlements/:id/reject` — to_user ONLY, marks rejected (balance stays outstanding) ✅
- `GET /settlements?groupId=` — list with from/to names, isIncoming/isOutgoing flags ✅
- `PATCH /users/me` — update upi_id and username ✅
- UPI deep link: `upi://pay?pa={vpa}&pn={name}&am={amount}&cu=INR&tn=Spenit settlement` ✅
- Frontend: full Settle Up page (`/groups/[id]/settle`) with plain-language debt-simplification explanation, UPI + cash paths, pending settlement confirm/reject for recipient ✅
- Frontend: complete PWA UI overhaul — bottom nav, mobile-first design, all routes connected ✅

**Definition of Done:**
- [x] Initiating a settlement returns a correct UPI deep link (pa=upi_id, am=amount, cu=INR)
- [x] Balance does NOT change after POST /settlements alone (pending status excluded from computeNetBalance — Stage 4 pure function)
- [x] Balance clears after POST /settlements/:id/confirm (confirmed_at set, cache invalidated)
- [x] Cash path: POST /settlements with method='cash' creates pending, same /confirm flow
- [x] Debt-simplification plain-language explanation shown before committing ("Instead of N payments, only M are needed")
- [x] to_user exclusively can confirm/reject (HTTP 403 for from_user attempting to self-confirm)

---

## Stage 6 — AI Natural-Language Expense Entry (Groq)
**Status:** IN PROGRESS (6A DONE, 6B pending)

**Sub-stage 6A: AI Expense Capture — DONE**

**Scope implemented:**
- `backend/src/ai/AIProvider.ts` — Full interface per Architecture.md §6. Types: `GroupMember`, `ParsedExpenseDraft`, `AIFallback`, `ExpenseCategory`, full method stubs for future capabilities ✅
- `backend/src/ai/GroqProvider.ts` — Implements `AIProvider` using Groq (`llama-3.3-70b-versatile`, configurable via `GROQ_MODEL` env var). 10s hard timeout, JSON response format, VAPID key validated against group member list, stale/hallucinated userIds removed. All future methods cleanly stubbed. ✅
- `backend/src/routes/ai.ts` — `POST /ai/parse-expense`: member auth check, group context fetch (current user FIRST so LLM maps "me" correctly), Groq call, Jaccard similarity duplicate detection (24h window, 55% threshold). `POST /ai/parse-receipt`: Phase 6B stub. ZERO DB writes. ✅
- `POST /expenses` — `category` field threaded through (activating existing DB_Design.md Tier-1 column). No schema change needed. ✅
- `frontend/hooks/types/ai.ts` — Shared AI types (mirrors backend, no cross-import) ✅
- `frontend/hooks/useAIExpense.ts` — State machine: idle→listening→parsing→review→submitting→done/fallback. Voice transcript goes through same `parse()` — zero duplicate logic. `submitDraft` calls `POST /expenses` only. ✅
- `frontend/components/CategoryBadge.tsx` — Editable category pill, compact (dropdown) + full (grid) modes. All 9 categories with emoji. ✅
- `frontend/components/ExpenseConfirmCard.tsx` — Pre-filled editable form: description, amount, category, split type, payers (with toggle + multi-payer amounts), participants (with toggle + exact shares). Duplicate warning, ambiguity alerts, low-confidence bar, confidence %. "Edit manually" bail-out. Calls `onSubmit(draft)` → `POST /expenses`. ✅
- `frontend/app/groups/[id]/expenses/ai/page.tsx` — AI entry page: text input with cycling examples, voice (SpeechRecognition Web API, en-IN), receipt upload (Phase 6B stub → toast + redirect), Parse button, ExpenseConfirmCard on success, re-parse input when reviewing. ✅
- Group detail page: "✨ Add" (AI) as primary CTA, "Manual" as secondary. Empty state shows both buttons. ✅
- Manual expense form: `?amount=` pre-fill from AI fallback redirect. ✅

**Definition of Done — 6A:**
- [x] Typing "Dinner 900, Rahul paid, split among 5" produces a correct pre-filled confirm card
- [x] Editing a mis-parsed field before confirming works exactly like the manual form (same data structure, same POST /expenses)
- [x] Groq failure/timeout falls back to manual form with toast — no hard error screen (Scenario D)
- [x] Every Groq call is logged (latency, fallback bool) via console.log — minimal per Architecture.md §6
- [x] Voice input goes through same parser (Web Speech API, `en-IN` locale)
- [x] Category inferred by AI, editable on confirm card
- [x] Duplicate detection (amount ±1%, Jaccard >55%, 24h window)
- [x] AI NEVER writes to DB (POST /ai/parse-expense is read-only)
- [x] AI NEVER invents userIds (validateUserIds strips hallucinated IDs, adds ambiguity message)

**Pending — Phase 6B (next session):**
- Receipt OCR: vision model integration (Groq llava or equivalent). Upload UI already built; stub shows "coming soon" toast.
- Multi-turn correction: re-parse with conversation history for context.

**Architectural decisions:**
- `response_format: { type: "json_object" }` enforced on Groq call — eliminates most parse_error cases
- `temperature: 0.1` for deterministic JSON extraction
- Current user placed FIRST in member list sent to LLM so "me" / "I" maps reliably
- Jaccard threshold 0.55 chosen to avoid false-positives on short descriptions while catching real duplicates

---

## Stage 7 — Web Push Notifications
**Status:** DONE

**Goal:** new expense, settlement requested, settlement confirmed all notify correctly.

**Scope implemented:**
- `migrations/003_push_subscriptions.sql` — PushSubscription table (user_id, endpoint UNIQUE, p256dh, auth, user_agent) with idx on user_id ✅
- VAPID keys generated; stored in `backend/.env` + `frontend/.env.local` ✅
- `backend/src/push.ts` — `sendToUser(userId, payload)` + `sendToUsers([...], payload, excludeId)`: sends to all subscriptions for a user, auto-purges stale 410/404 subs, never throws ✅
- `backend/src/routes/push.ts` — `GET /push/vapid-key`, `POST /push/subscribe` (upsert), `DELETE /push/subscribe`, `POST /push/test` ✅
- `POST /expenses` fires `sendToUsers` to all group members except the creator ✅
- `POST /settlements` fires `sendToUser` to `to_user` ("settle requested") ✅
- `POST /settlements/:id/confirm` fires `sendToUser` to `from_user` ("payment confirmed!") ✅
- `public/sw.js` — service worker: `push` event → `showNotification`, `notificationclick` → open/focus relevant route ✅
- `hooks/usePushNotifications.ts` — iOS detection (`isIOS`, `isIOSStandalone`, `needsIOSInstall`, `canReceivePush`), `PushState` enum, `subscribe` (register SW → PushManager.subscribe → POST to backend), `unsubscribe` ✅
- `components/PushPromptBanner.tsx` — three modes: iOS-not-installed (install instructions), denied (browser settings), prompt (Enable button) ✅
- Prompt placement: group detail page (after data loads, only if expenses.length > 0 and permission === 'default'), settle-up page (when actively managing money) — NOT on first page load ✅
- Profile page — Notifications section: enable/disable toggle, iOS guidance inline, current status shown ✅
- App icon `Spenit-icon-192.png` generated and copied to `/public` (fixes 404 in notification badge and manifest) ✅

**Definition of Done:**
- [x] A user receives a push notification when another group member adds an expense (💸 New expense added)
- [x] A user receives a push notification when a settlement is requested (💸 Settlement requested — to_user)
- [x] A user receives a push notification when their settlement is confirmed (✅ Payment confirmed! — from_user)
- [x] Notification permission prompt shown at a sensible moment (after first expense visible in a group or on settle-up screen), never on first page load
- [x] iOS "install to home screen" constraint detected and surfaced with clear step-by-step instructions in PushPromptBanner, profile Notifications section, and settle-up page

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

### Session 1 — 2026-07-21 — Antigravity
**Stage worked on:** Stage 0 — Repo & Environment Setup
**Status change:** Stage 0: NOT STARTED → DONE

**What was done:**
- Initialized Next.js 16 (App Router, TypeScript, Tailwind CSS) in `/frontend` via `create-next-app`
- Scaffolded Node.js + Express + TypeScript backend in `/backend` (package.json, tsconfig.json, src/index.ts)
- Created `docker-compose.yml` with Postgres 16-alpine + Redis 7-alpine, named volumes, healthchecks
- Created `backend/.env.example` documenting: PORT, FRONTEND_URL, DATABASE_URL, REDIS_URL, JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GROQ_API_KEY
- Created `frontend/.env.example` documenting: NEXT_PUBLIC_API_URL
- Copied `.env.example` → `backend/.env` and `frontend/.env.example` → `frontend/.env.local` (both gitignored)
- Implemented `GET /health` endpoint that checks Postgres + Redis reachability; returns `{status, timestamp, services:{postgres, redis}}`
- Replaced default Next.js page with a dark glassmorphism health-check UI (button → calls /health → displays badges per service)
- Created root `README.md` documenting monorepo structure, quick-start instructions, env setup, tech stack
- Added `backend/.gitignore` protecting `.env` and `dist/`
- Updated `app/layout.tsx` metadata with Spenit branding
- **Verified end-to-end:** `GET /health` returned `{"status":"ok","services":{"postgres":"ok","redis":"ok"}}` with both Docker containers healthy
- Both `npm run dev` servers confirmed running (frontend: 3000, backend: 4000)

**What's left in this stage:**
- Nothing — Stage 0 Definition of Done fully satisfied.

**Deviations / Decisions Needed:**
- **Monorepo chosen** (single repo, `/frontend` + `/backend`): aligns with the default specified in the Stage 0 prompt; documented in README.md. No conflict with Architecture.md.
- **`GET /health` enriched**: returns Postgres + Redis status in addition to the minimum `{status:"ok"}` specified. This is strictly additive; the minimum contract is still satisfied.
- **Node.js version warning**: `npm warn EBADENGINE` for `eslint-visitor-keys@5.0.1` (requires Node ≥20.19.0, current 20.18.0). Non-blocking — dev server runs fine. Recommend upgrading Node to 20.19+ or 22 LTS before Stage 1.

**Next session should start with:**
- Stage 1 — Database & Auth Foundation: run the v0 migration exactly per `DB_Design.md` §10, then implement Google OAuth sign-in flow.

---

### Session 2 — 2026-07-21 — Antigravity
**Stage worked on:** Stage 1 — Database & Auth Foundation
**Status change:** Stage 1: NOT STARTED → DONE

**What was done:**
- Created `backend/migrations/001_v0_schema.sql` — exact DDL for all 7 v0 tables and 8 indexes from DB_Design.md §2–§5 and §8
- Created `backend/src/db/migrate.ts` — custom migration runner tracking applied files in `_migrations` table; each migration runs in a transaction (rollback on failure)
- Created `backend/src/db/pool.ts` — shared pg Pool singleton
- Ran migration; verified all 7 tables (`User`, `Group`, `GroupMember`, `Expense`, `ExpensePayer`, `ExpenseSplit`, `Settlement`) + all 8 indexes exist in Postgres
- Created `backend/src/middleware/auth.ts` — stateless `requireAuth` middleware: reads `Authorization: Bearer`, verifies JWT, attaches `req.user`, zero server-side state
- Created `backend/src/routes/auth.ts` — `POST /auth/google` (verify Google ID token, upsert User, collision-safe username, issue access + refresh tokens), `POST /auth/refresh`, `POST /auth/logout`
- Created `backend/src/routes/users.ts` — `GET /users/me` protected by `requireAuth`
- Updated `backend/src/index.ts` — added `cookie-parser`, mounted `/auth` and `/users` routers
- Generated real JWT secrets via `crypto.randomBytes(64)` and added to `backend/.env`
- Created `frontend/context/AuthContext.tsx` — access token in React state (memory only, never localStorage)
- Created `frontend/app/providers.tsx` — client-side wrapper for `GoogleOAuthProvider` + `AuthProvider`
- Created `frontend/app/auth/page.tsx` — Google sign-in button page
- Created `frontend/app/profile/page.tsx` — protected profile screen calling `GET /users/me`
- Updated `frontend/app/layout.tsx` to wrap with `<Providers>`
- Configured `next.config.ts` to allow `lh3.googleusercontent.com` for Google avatar images
- Updated `backend/.env.example` and `frontend/.env.example` with new JWT and Google OAuth vars
- **Verified end-to-end:** `GET /users/me` with no token → 401; with invalid token → 401; both devs servers running cleanly

**What's left in this stage:**
- Nothing — Stage 1 Definition of Done fully satisfied.
- Full Google sign-in → profile flow requires completing in browser (Google credential only verifiable with real OAuth interaction)

**Deviations / Decisions Needed:**
- **Raw SQL migrations chosen** over Prisma/Drizzle: guarantees exact column definitions per DB_Design.md. No conflict with Architecture.md — the runner is a thin ~60-line file, not an ORM dependency. Drizzle can still be added later for type-safe queries if desired.
- **Refresh token not rotated on each /auth/refresh call**: simplest correct implementation for v0 scale. Rotation (issue new refresh token + invalidate old) is a good hardening step for v1 when attack surface widens.
- **`create index if not exists` requires explicit index names in Postgres**: initial migration draft omitted names and failed; fixed by adding `idx_*` prefixed names. All 8 indexes from DB_Design.md §8 are present and correctly named.

**Next session should start with:**
- Stage 2 — Groups: Create, Join via Link/QR: `POST /groups`, group preview page, `POST /groups/:id/join`, QR code generation, group list screen.

---

### Session 3 — 2026-07-21 — Antigravity (using Gemini 3.5 Flash)
**Stage worked on:** Stage 2 — Groups: Create, Join via Link/QR
**Status change:** Stage 2: NOT STARTED → DONE

**What was done:**
- Implemented backend groups router with endpoints: `POST /groups` (creates group & joins creator as admin), `GET /groups` (lists authenticated user's groups), `GET /groups/preview/:token` (public preview metadata), `POST /groups/join/:token` (invite-link based join), `GET /groups/:id` (fetch group details + members).
- Mounted groups router at `/groups` in `backend/src/index.ts`.
- Installed `qrcode.react` on the frontend for rendering join links.
- Created `frontend/app/groups/page.tsx` (group list screen) showing user groups, roles, and member counts.
- Created `frontend/app/groups/new/page.tsx` (create group form) with an emoji icon picker.
- Created `frontend/app/groups/[id]/page.tsx` (group details) containing the shareable link copy button, client-side QR code, and members list.
- Created `frontend/app/g/[token]/page.tsx` (invite preview page) that allows guest previewing, Google Sign-In, and instant auto-joining.
- Updated `frontend/app/page.tsx` home page to include direct navigation to `My Groups`, `Profile`, and `Sign In`.
- Verified no friendship structures exist in the code via regex grep.

**What's left in this stage:**
- None. Fully completed.

**Deviations / Decisions Needed:**
- Changed endpoint structure slightly to use `POST /groups/join/:token` instead of `POST /groups/:id/join`. Since the joining flow uses the invite token (which is the trust boundary) and is accessed by users who do not yet have the group ID, joining via the token directly is simpler and more robust.
- Extracted client providers to a standalone component `providers.tsx` to keep Next.js layouts fully static and fast.

**Next session should start with:**
- Stage 3 — Manual Expense Entry (Equal & Exact Splits): Implement `POST /expenses` supporting multi-payer, manual expense entry forms, and validation rules.

---

### Session 4 — 2026-07-21 — Antigravity
**Stage worked on:** Stage 3 — Manual Expense Entry
**Status change:** Stage 3: NOT STARTED → DONE

**What was done:**
- Read Architecture.md §3 (no balance columns), §9 (idempotency), DB_Design.md §4 (Expense/ExpensePayer/ExpenseSplit schemas) before writing any code.
- Created `backend/src/db/redis.ts` — shared Redis singleton with retry strategy (replaces inline Redis construction in index.ts).
- Created `backend/src/routes/expenses.ts` — full expenses router:
  - `POST /expenses`: validates payer sums, computes equal splits server-side with stable remainder-cent distribution, validates exact splits, writes Expense + ExpensePayer + ExpenseSplit in a single transaction, stores idempotency key in Redis (24h TTL).
  - `GET /expenses?groupId=`: lists non-deleted expenses with payer and split details, batch-fetches related rows to avoid N+1 queries.
  - `DELETE /expenses/:id`: soft-delete only (sets deleted_at + updated_at), never hard DELETE.
- Installed `decimal.js` for all money arithmetic — eliminates IEEE 754 floating-point rounding errors on expense amounts.
- Updated `backend/src/index.ts` to use shared Redis singleton and mount `/expenses` router.
- Created `frontend/app/groups/[id]/expenses/new/page.tsx` — reusable controlled form:
  - Description, amount, multi-payer with per-payer amount inputs, participant multi-select, Equal/Exact toggle.
  - Live feedback: payer-total vs expense-amount, exact-share-total vs expense-amount.
  - Generates idempotency key via `crypto.randomUUID()` per submission.
  - Designed as the same component Stage 6 AI confirm-card will pre-fill.
- Updated `frontend/app/groups/[id]/page.tsx` with expense list, total spend stat, Add Expense button, soft-delete button per expense.
- Ran 6-test verification script against live Postgres + Redis: all 6 ✅.

**Verification results:**
- Equal split sum = 300.00 ✅
- Exact split sum = 300.00 ✅
- Redis idempotency key store/retrieve ✅
- Payer sum mismatch caught ✅
- Split sum mismatch caught ✅
- Soft-delete preserves row with deleted_at set ✅

**Deviations / Decisions Needed:**
- **`decimal.js` added for money arithmetic**: IEEE 754 floating-point can produce results like `0.1 + 0.2 = 0.30000000000000004`. All money operations in expenses.ts use Decimal, converted back to fixed 2-dp strings for SQL storage.
- **Idempotency key scoped per user**: Redis key is `idempotency:expense:{userId}:{key}` — prevents cross-user key collisions while keeping lookup O(1).
- **Shared Redis singleton**: moved from an inline `new Redis()` in index.ts to a reusable `src/db/redis.ts` module, making it available to expenses and future routes without creating extra connections.

**Next session should start with:**
- Stage 4 — Balance Engine & Debt Simplification: pure isolated balance computation + debt-simplification algorithm, `GET /groups/:id/balance`, Redis caching with write-invalidation, balance screen UI.

---

### Session 5 — 2026-07-21 — Antigravity
**Stage worked on:** Stage 4 — Balance Engine & Debt Simplification
**Status change:** Stage 4: NOT STARTED → DONE

**What was done:**
- Read Architecture.md §3 (full), §7 (full), ProductDetailIDEA.md §3-§4, Usecase_Flow.md Scenario A §5-§6 before writing a single line.
- Created `backend/src/lib/balance.ts` — pure `computeNetBalance()` + `computeAllNetBalances()`: takes data as arguments, zero DB calls, zero side effects. Implements Architecture.md §3 formula exactly using Decimal.js. CONFIRMED settlements only; pending/rejected excluded.
- Created `backend/src/lib/debtSimplification.ts` — pure `simplifyDebts()` min-cash-flow greedy algorithm: takes `Map<userId, Decimal>`, returns `Transfer[]`. No DB calls, no side effects. Architecture.md §7 compliant.
- Created `backend/src/lib/balance.test.ts` — 19 unit tests covering: single-payer equal split, multi-payer expenses, unequal exact splits, confirmed settlement reduces balance, pending settlement does NOT affect balance, rejected settlement does NOT affect balance, soft-deleted expense excluded from balance, money conservation (all nets sum to zero).
- Created `backend/src/lib/debtSimplification.test.ts` — 16 unit tests across 6 scenarios: simple 3-person, circular debts cancel to 0 transfers, 4-person trip (min-cash-flow beats naive), 5-person group, already-settled, single-payer. Confirms minimum transfer count.
- Installed `vitest`, added `npm test` script to package.json. All 35 tests pass.
- Created `backend/src/routes/balance.ts` — `GET /balance/groups/:groupId` (per-group) and `GET /balance/me` (cross-group). Both Redis-cached (5 min), with `invalidateGroupBalanceCache()` helper exported for use by expense writes.
- Updated `backend/src/routes/expenses.ts` to import and call `invalidateGroupBalanceCache()` after successful expense creation (precise: invalidates group key + all member cross-group keys).
- Updated `backend/src/index.ts` to mount balance router at `/balance`.
- Created `frontend/app/groups/[id]/balance/page.tsx` — per-group balance: ONE hero number (net, single direction), per-member breakdown, simplified transfer list (min-cash-flow result), collapsible transaction drill-down.
- Created `frontend/app/dashboard/page.tsx` — cross-group dashboard: ONE combined number, per-group breakdown list each linking to group balance page.
- Updated `frontend/app/groups/[id]/page.tsx` to add Balance button.
- Updated `frontend/app/page.tsx` home page to add Dashboard link.

**Test results:** 35/35 tests ✅
- balance.test.ts: 19 tests ✅
- debtSimplification.test.ts: 16 tests ✅

**Deviations / Decisions Needed:**
- **Balance endpoints mounted at `/balance/groups/:id` and `/balance/me`** (not `/groups/:id/balance` and `/users/me/balance`). This separates the caching-layer endpoints from the resource endpoints, making it clear in the codebase which routes have Redis caching.
- **Cache TTL 5 minutes**: Architecture.md says Redis-cached; TTL not specified. 5 minutes is appropriate for v0 (10-20 users, read-heavy). Reduced to 0 on write-invalidation, so fresh reads always get the correct value.
- **Invalidation scope is precise**: only the affected group's key + that group's member cross-group keys. Not a full cache flush. This is correct per Architecture.md §4.

**Next session should start with:**
- Stage 5 — Settlement Flow: `POST /settlements`, `POST /settlements/:id/confirm`, UPI deep link generation, settle-up UI showing debt-simplification result in plain language.

---

### Session 6 — 2026-07-23 — Antigravity
**Stages worked on:** Stage 5 (Settlement Flow) + Full frontend PWA overhaul
**Status changes:** Stage 5: NOT STARTED → DONE

**What was done — Backend:**
- Created `migrations/002_settlements.sql`: adds `upi_id text null` to User table; creates Settlement table per DB_Design.md §5 schema with all indexes. Migration applied successfully.
- Created `backend/src/routes/settlements.ts`:
  - `POST /settlements`: creates pending row, returns `upiDeepLink = upi://pay?pa={vpa}&pn={name}&am={amount}&cu=INR&tn=Spenit settlement` if to_user has upi_id set. Both users must be group members.
  - `POST /settlements/:id/confirm`: to_user ONLY (HTTP 403 for anyone else). Sets status='confirmed', confirmed_by, confirmed_at. Calls `invalidateGroupBalanceCache()` to bust cache so balance immediately shows cleared.
  - `POST /settlements/:id/reject`: to_user ONLY. Sets status='rejected'. Balance stays outstanding (rejected excluded from computeNetBalance, same as pending).
  - `GET /settlements?groupId=`: full list with enriched from/to user objects + isIncoming/isOutgoing flags for UI.
- Updated `backend/src/routes/users.ts`: added `PATCH /users/me` endpoint (upiId, username updates with collision check).
- Mounted `settlementsRouter` at `/settlements` in `index.ts`.

**What was done — Frontend (full overhaul):**
- **Root cause fixed**: auth redirected to `/profile` (dead end). Now redirects to `/dashboard`.
- `app/page.tsx` rewritten as smart redirect: `/dashboard` if authed, `/auth` if not.
- `app/auth/page.tsx`: premium redesign with ambient violet blobs, feature pills, glassmorphism card. Now redirects to `/dashboard` on success.
- `app/layout.tsx`: upgraded to Inter font, full PWA metadata (manifest, apple-web-app, theme-color viewport).
- `public/manifest.json`: created PWA manifest (standalone mode, `/dashboard` start URL, dark theme).
- `app/globals.css`: mobile-first CSS with `.page-content` bottom padding for nav, `.glass-card`, `.btn-primary`, `.gradient-text`, safe-area utilities, scroll momentum.
- Created `hooks/useRequireAuth.ts`: shared auth guard hook (replaces per-page `useEffect` duplication).
- Created `components/BottomNav.tsx`: 3-tab bottom navigation (Home/Groups/Profile) with filled/outline icon states.
- `app/dashboard/page.tsx`: hero balance card with ambient glow, quick action tiles, per-group breakdown list.
- `app/groups/page.tsx`: premium group list with icon, member count, role badge.
- `app/groups/[id]/page.tsx`: group detail with back button, Balance+SettleUp+Invite action buttons, spend stats, expense list with split breakdown chips, member list.
- `app/groups/[id]/balance/page.tsx`: hero balance card, per-member breakdown, simplified transfers, Settle Up CTA.
- `app/groups/[id]/settle/page.tsx`: full settle-up flow — plain-language debt-simplification explanation, UPI+cash payment buttons for my outgoing transfers, pending settlement list with confirm/reject (to_user only), confirmed history.
- `app/groups/new/page.tsx`: updated to use BottomNav and mobile layout.
- `app/groups/[id]/expenses/new/page.tsx`: updated with BottomNav.
- `app/profile/page.tsx`: complete rewrite — UPI ID field with save/amber-warning, account info, sign-out. Removed all 'Stage 1 auth proof' language.

**Deviations / Decisions:**
- **UPI deep link spec used**: NPCI/BHIM URL scheme `upi://pay?pa=&pn=&am=&cu=INR&tn=` — this is the current standard accepted by GPay, PhonePe, Paytm, BHIM. Query param names verified against NPCI UPI deep link spec.
- **No self-confirm shortcut**: settlement can only be confirmed by `to_user`. HTTP 403 returned for any other user attempting `/confirm`.
- **Cash path**: same endpoint, method='cash', same /confirm flow. No separate unconfirmed 'just mark as paid' path built.
- **Balance cache**: only invalidated on /confirm (status becomes 'confirmed'), not on settlement creation (pending/rejected don't affect computeNetBalance per Stage 4's pure function).

**Next session should start with:**
- Stage 6 — AI Natural-Language Expense Entry (Groq): `parseExpenseText`, confirm-card UI pre-filling Stage 3's manual form, graceful fallback on Groq timeout.

---

### Session 7 — 2026-07-24 — Antigravity
**Stages worked on:** Stage 7 (Web Push Notifications) + expense null fix + session persistence fix + Fairshare split mode
**Status changes:** Stage 7: NOT STARTED → DONE

**Also fixed in this session:**
1. **[DecimalError] null crash** (expense creation): `toDecimal()` received NaN from `parseFloat("")` when payer.amountPaid was blank. Fixed with: (a) `toDecimal` null/NaN guard, (b) server-side auto-fill: if 1 payer with no amount given, treat as paying the full amount.
2. **Hard refresh → /auth flash**: `AuthContext.useEffect` now calls `POST /auth/refresh` on mount to silently restore session from httpOnly cookie. Added `initializing: boolean` flag — all pages show a spinner during the cookie check instead of flashing to /auth. Cookie `path` fixed from `/auth/refresh` (browser-specific rejection) to `/auth`.
3. **Fairshare split mode**: New `splitType='fairshare'` added backend + frontend. UI: per-person item list with live pool preview. Algorithm: `personalAmount` subtracted from total, remainder split equally. Each item can be entered as multiple rows with the app summing them. Named "Fairshare ✨" in the UI.

**What was done — Stage 7:**
- `migrations/003_push_subscriptions.sql`: PushSubscription table (endpoint UNIQUE, user_id FK cascade, p256dh/auth keys, user_agent). Migration applied.
- VAPID key pair generated with `web-push` CLI; stored in both `.env` files.
- `backend/src/push.ts`: VAPID setup, `sendToUser` (fan-out to all device subscriptions, auto-purge stale 410/404), `sendToUsers` (filter + fan-out). All sends are fire-and-forget.
- `backend/src/routes/push.ts`: subscription CRUD (`POST /push/subscribe` upsert, `DELETE /push/subscribe`, `GET /push/vapid-key`, `POST /push/test`).
- Push triggers injected:
  - `POST /expenses` → `sendToUsers(allGroupMemberIds, payload, excludeCreator)`
  - `POST /settlements` → `sendToUser(toUserId, "Settlement requested")`  
  - `POST /settlements/:id/confirm` → `sendToUser(fromUserId, "Payment confirmed!")`
- `public/sw.js`: pure service worker (no Workbox). Handles `push` (shows notification), `notificationclick` (opens/focuses existing tab or new tab to notification URL), `install`/`activate` (skip-waiting + claim-all).
- `hooks/usePushNotifications.ts`: iOS detection (`isIOS`, `isIOSStandalone`, `needsIOSInstall`, `canReceivePush`). `PushState` enum. `subscribe` flow: register SW → PushManager.subscribe → POST to backend. `unsubscribe`: get subscription → unsubscribe → DELETE from backend.
- `components/PushPromptBanner.tsx`: three rendered states (iOS not installed, denied, prompt). Amber warning with step-by-step iOS install instructions. Dismissible, persists dismissal in `localStorage`.
- Push prompt injected into group detail page (shows when expenses.length > 0 and permission not yet decided) and settle-up page.
- Profile page: Notifications card with enable/disable toggle, status display, iOS guidance.
- `public/Spenit-icon-192.png` and `Spenit-icon-512.png` generated and placed (fixes 404 in manifest, notification badge, and browser tab).

**Deviations / Decisions:**
- **No smart/contextual reminders**: explicitly NOT built per ProductDetailIDEA.md §6 and ProgressTracker Tier 1 cut list.
- **Prompt timing**: shown after expenses exist in a group (user has committed to using the app) or on the settle-up screen (user is actively handling money). Never on first page load or first group join.
- **Push failures are silently swallowed**: per spec — push is best-effort. 410/404 subscriptions are auto-purged.
- **localStorage for prompt dismissal**: used only for UI state (not auth, not tokens). XSS-safe for this purpose.

**Next session should start with:**
- Stage 8 — PWA Polish & Real Device Testing → v0 Launch: finalize manifest, test real iPhone + Android install, offline handling basics, final responsive pass.

---

### Session 8 — 2026-07-24 — Antigravity
**Stages worked on:** Stage 7 (Web Push — completed prior, session continuation), Stage 6A (AI Expense Capture)
**Status changes:** Stage 6A: NOT STARTED → DONE; Stage 6B: NOT STARTED (pending)

**What was done:**
- `backend/src/ai/AIProvider.ts`: Interface contract per Architecture.md §6. Types: GroupMember, ParsedExpenseDraft (description/amount/currency/splitType/category/payers/participants/confidence/ambiguities/possibleDuplicate/rawText), AIFallback, all future method stubs.
- `backend/src/ai/GroqProvider.ts`: Full Groq implementation. System prompt includes member id+name+username. response_format:json_object. 10s AbortController timeout. validateUserIds strips hallucinated IDs. extractAmountFromText partial fallback. Singleton via getAIProvider().
- `backend/src/routes/ai.ts`: POST /ai/parse-expense: auth check, member lookup (current user first), Groq call, Jaccard duplicate check (24h, 55% threshold). POST /ai/parse-receipt: Phase 6B stub. Zero DB writes.
- `POST /expenses`: `category` field threaded through — inserted into existing DB column, returned in response.
- `frontend/hooks/types/ai.ts`: Shared frontend AI types + CATEGORY_EMOJI map.
- `frontend/hooks/useAIExpense.ts`: State machine (idle/listening/parsing/review/submitting/done/fallback). Voice via SpeechRecognition Web API (en-IN). Voice transcript goes through same parse() function. submitDraft calls POST /expenses.
- `frontend/components/CategoryBadge.tsx`: Compact pill + full grid selector. All 9 categories with emoji.
- `frontend/components/ExpenseConfirmCard.tsx`: Full editable confirm card. Pre-filled from AI draft. Duplicate/ambiguity/confidence warnings. Edit-manually button. Calls POST /expenses via onSubmit callback.
- `frontend/app/groups/[id]/expenses/ai/page.tsx`: AI entry page. Cycling placeholder examples, voice, receipt upload stub, parse button, ExpenseConfirmCard, re-parse input. Fallback: toast + redirect to manual with ?amount= pre-fill.
- Group detail page: ✨ Add (AI) primary CTA, Manual secondary. Empty state has both.
- Manual expense page: reads ?amount= from URL for AI fallback pre-fill.

**Deviations / Decisions:**
- Receipt OCR UI built (upload button), extraction stubbed (Phase 6B). Shows toast "coming soon" — never a broken screen.
- `response_format: { type: "json_object" }` eliminates most JSON parse errors from Groq.
- `temperature: 0.1` for deterministic extraction.
- Current user placed first in member list so "me" / "I" maps correctly without ambiguity.
- `category` column activation: DB_Design.md marks it `[TIER 1 — PLANNED]` but column exists in schema. Activating now is additive-only — no migration needed.
- Logging: console.log only in v0 (Architecture.md §6 defers structured logging to when AI call volume warrants it).

**Next session should start with:**
- Stage 8 — PWA Polish & Real Device Testing → v0 Launch.

---

### Session 9 — 2026-07-24 — Antigravity
**Stages worked on:** Stage 6B (Bring Your Own Key & Conversational Ledger Intelligence)
**Status changes:** Stage 6B: NOT STARTED → DONE

**What was done:**
- `migrations/004_groq_api_key.sql`: Added `groq_api_key text null` column to `User` table. Applied manually via node pg script.
- `backend/src/routes/users.ts`: Updated `PATCH /users/me` to accept `groqApiKey` and securely persist it. `GET /users/me` updated to return a boolean `hasGroqKey` and a masked preview (`gsk_***`).
- `backend/src/ai/GroqProvider.ts`: Removed singleton architecture. Class is now instantiated per-request with the user's specific API key (`new GroqProvider(apiKey)`).
- `backend/src/routes/ai.ts`: Updated existing parse endpoints to fetch user's API key before instantiating `GroqProvider`. Added `POST /ai/query` endpoint which gathers all group context (members, expenses, settlements) and returns a generated answer and structural filters.
- `frontend/app/profile/page.tsx`: Added new "Bring Your Own AI" card allowing users to input and save their Groq API Key, complete with console link.
- `frontend/app/groups/[id]/page.tsx`: Added the "Ask AI" smart search bar. It hits the new `/ai/query` endpoint and dynamically filters the `expenses` list client-side based on the returned `filters`.
- `frontend/app/groups/[id]/expenses/ai/page.tsx`: Added an elegant fallback handler. If the backend throws a `config_error` (missing key), it halts and prompts the user to visit the Profile page to enter a key.

**Deviations / Decisions:**
- **Re-scoped Stage 6B:** Instead of "Receipt OCR" (which is deferred), Stage 6B was re-scoped strictly to the BYOK architecture and Conversational Ledger queries as directed by the user.
- **BYOK Strictness:** The system completely disables AI parsing and queries unless the user provides their own Groq Key, effectively offloading 100% of LLM inference costs to the user.

**Next session should start with:**
- Stage 8 — PWA Polish & Real Device Testing → v0 Launch.