# Architecture & System Design
### Every technical decision, and the reasoning behind it — this document is the "how"

This document is written so that a decision made at v0 doesn't need to be
re-litigated at v1 or Tier 2. Where a choice is deliberately narrow for v0 but
designed to extend later, that's called out explicitly.

---

## 1. Tech Stack (Final)

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Next.js** (App Router), React, TypeScript | Web-first PWA, mobile-first responsive UI, deploys to Vercel free tier with CDN + auto-scaling built in. Single codebase for the "cross-platform" requirement. |
| Styling | Tailwind CSS | Fast to build mobile-first responsive layouts; pairs well with a component-driven build process an AI IDE can execute in small steps. |
| Backend | **Node.js + Express** | Matches existing strongest backend skill (see builder's background); stateless from day one (see §4). |
| Database | **PostgreSQL** | Relational integrity matters a lot here — balances, ledgers, and multi-party splits are inherently relational. Also the right choice for the append-only ledger design (§5). |
| Cache / rate-limit | **Redis** | Caches the one genuinely hot computation (balance lookups) and backs the Groq call rate-limit counter. Same instance can later back a job queue (BullMQ) with zero new infra. |
| Auth | **Google Sign-In only for v0**; email/OTP added at v1 | Every friend already has Google — removes a whole flow to build/test for the first real usage. |
| AI provider | **Groq** (Llama 3.1/3.3 8B or 70B), behind an internal `AIProvider` interface | Fast inference, generous free-tier rate limits, good fit for structured JSON extraction. The interface abstraction means swapping providers later is a config change, not a rewrite. |
| Payments | **Deep-link generation only** (UPI: GPay/PhonePe/Paytm/BHIM; Venmo/PayPal as the same-mechanism fallback for non-India users) | Keeps the app out of PCI/financial-license scope entirely, for v0 and for the foreseeable future. |
| Hosting (frontend) | Vercel (free tier) | Auto-scaling, CDN, doesn't sleep on inactivity — solves the "will this randomly go to sleep" problem at the frontend layer. |
| Hosting (backend) | Single VM (PM2 + Nginx), reusing the builder's existing Rewple deployment pattern | Known, already-solved deployment pattern; no new infra to learn for v0. Deliberately minimal — no load balancer, no read replica, no job queue yet (see §8). |
| PWA | Web app manifest + service worker | Installable on iOS/Android home screen; works on iOS Safari and Android Chrome. iOS push requires home-screen install (iOS 16.4+) — documented constraint, not a bug. |

---

## 2. Core Architectural Principle: AI Is Never the Source of Truth for Money

This is restated here because it drives real code structure (not just product
framing — see `ProductDetailIDEA.md` §5 for the product reasoning):

- All balance computation is **deterministic backend arithmetic**. No AI call sits
  anywhere in the code path that computes who-owes-whom.
- The `AIProvider` interface has exactly two jobs across the entire app:
  1. **Parse**: unstructured input → structured JSON (expense fields, receipt line
     items).
  2. **Phrase**: backend-computed structured data → natural-language text.
- Every AI-parsed result is shown to the user as an **editable confirm-card**
  before it's persisted. The AI never writes to the database directly — it always
  returns a suggestion that a normal API call (the same one the manual form uses)
  then commits.
- This means the manual-entry code path and the AI-entry code path **converge on
  the same backend validation and persistence logic**. AI entry is a UX shortcut
  that pre-fills the manual form's payload, not a separate write path. This is
  important for correctness and for keeping the codebase simple to reason about.

## 3. Balances Are Always Derived, Never Stored

**Decision:** there is no `balance` column anywhere, on any table, at any version.

Balance for any user/group is always computed at read-time from the immutable
`Expense` + `ExpensePayer` + `ExpenseSplit` + `Settlement` log — the same principle
as double-entry bookkeeping. This eliminates an entire bug class ("balance drifted
from reality") permanently, and it's why the cache strategy in §4 is safe: caching
a derived read is safe to invalidate and recompute; caching a stored mutable field
risks silent drift.

Computation shape (unchanged from v0 through all future tiers):
```
net_balance(user, group) = sum(amounts they're owed from ExpenseSplit as a payer)
                          − sum(amounts they owe from ExpenseSplit as a participant)
                          − net effect of confirmed Settlements
```
This is intentionally simple arithmetic — fully unit-testable, with no AI and no
external service in the computation path.

## 4. Statelessness & Caching

- Express servers are **stateless** — no in-memory session state, no local file
  writes on the API server. JWT access token + refresh cookie, no server-side
  session store. This means any instance is killable/replaceable at any time, which
  is what makes horizontal scaling later (see §8) a config change, not a rewrite.
- The one genuinely hot computation is balance lookup (`GET /users/me/balance`,
  `GET /groups/:id/balance`). This is Redis-cached with invalidation on any write
  that affects a balance (new expense, new settlement, settlement confirmation).
  This is the single most important scale decision made this early, and it costs
  nothing extra to build now vs retrofitting later.
- Read-heavy, write-light assumption: people check balances far more often than
  they add expenses. Optimize for fast cached reads; a few hundred ms of write
  latency on "add expense" is fine.

## 5. Database Design Philosophy (Full Detail in `DB_Design.md`)

- Tables are **append-only** for `Expense` and `Settlement` — soft-delete only,
  never hard-delete. This protects against accidental data loss and keeps the
  audit trail (and the derived-balance principle in §3) intact.
- Indexes on real hot queries are added from day one, not discovered under load:
  `GroupMember(user_id)`, `Expense(group_id, created_at)`,
  `Settlement(group_id, status)`.
- The **v0 schema is a strict subset of the full planned schema.** Tables needed
  only for later tiers (`ExpenseItem`, `ExpenseItemAssignment`, `Category`,
  `MerchantCategoryCache`, currency/FX fields, `TripWorkspace`, `Subscription`,
  etc.) are fully designed in `DB_Design.md` now, but not created by the v0
  migration. This means v1+/Tier 2 work is "add a table and wire it up," never
  "redesign the existing tables to fit a feature we didn't plan for."
- **Identity uses `id` + `username` + `name`, never `name` alone.** `id` is the
  internal foreign-key source of truth. `username` is a unique, disambiguating
  handle (auto-generated at signup for v0 — `firstname` → `firstname2` on
  collision — editable later in profile settings). `name` is a purely cosmetic
  display label that can collide (two "Prashant"s in one group). This is what
  lets the AI natural-language parser and the manual participant-picker
  disambiguate identical display names without a redesign later. Full detail and
  reasoning in `DB_Design.md` §2.

## 6. AI Integration Detail

- **Provider**: Groq, free tier for v0 (10–20 users, ~1–5 NL expense entries/day
  each ≈ 20–100 calls/day — comfortably inside free-tier headroom for a small
  Llama model doing structured JSON extraction).
- **Abstraction**: an `AIProvider` interface is built starting in v0 even though
  only one feature (NL expense entry) uses it. This costs nothing extra now and
  means adding OpenAI/Anthropic/self-hosted as a second provider, or moving off
  free tier, is a config change later — not a rewrite. Interface shape (stable
  across all versions):
  ```ts
  interface AIProvider {
    parseExpenseText(input: string, groupContext: GroupMember[]): Promise<ParsedExpenseDraft>
    // later tiers add, without changing this interface's contract:
    parseReceiptText(ocrText: string, groupContext: GroupMember[]): Promise<ParsedReceiptDraft>
    phraseSettlementExplanation(simplifiedTransfers: Transfer[]): Promise<string>
    phraseSpendSummary(aggregatedStats: SpendStats): Promise<string>
    answerLedgerQuery(question: string, queriedData: QueryResult): Promise<string>
  }
  ```
- **Fallback discipline**: if a Groq call fails or is slow, the manual Equal/Exact
  form is always one tap away. AI availability never blocks core app usage — this
  is a hard rule, not a nice-to-have, from v0 onward.
- **Rate-limit handling**: a Redis-backed usage counter tracks Groq calls. At v0
  scale (10–20 users) no queueing is needed. At v1+/scale, the same counter
  gracefully falls back to a queued request or the manual form (see
  `Scalability` notes below) rather than erroring out to the user.
- **No caching layer in v0** — categorization/merchant caching is a later-tier
  concern (smart categorization ships in v1+), not needed for the single NL-entry
  feature in v0. Don't build it early; it's noise until the feature that needs it
  exists.

## 7. Debt Simplification Algorithm

- A classic min-cash-flow graph reduction: given a set of net balances within a
  group, compute the minimum number of transfers required to zero everyone out
  (repeatedly settle the largest creditor against the largest debtor).
- This is built as an **isolated, pure, unit-tested function** — no side effects,
  no DB calls inside it, takes a list of net balances and returns a list of
  `{from, to, amount}` transfers. This isolation is deliberate: it's cheap to
  build, it's a strong interview/portfolio talking point on its own, and keeping
  it pure means it's trivially testable and reusable unchanged across every future
  version.
- Runs on-demand at "Settle Up" time — not stored, not cached (it's cheap to
  compute from already-cached balance data).

## 8. Scalability Posture (What's Built Now vs What's Deferred)

**Principle:** the v0 architecture should not require a rewrite if usage jumps
100x later — but almost none of the actual scale infrastructure should be built
for a 10–20 person friend group. Build the *shape* that allows scaling; don't
build the scale infrastructure itself yet.

**Built in from day one (cheap now, expensive to retrofit):**
- Stateless Express servers (→ horizontal scaling later is a config change)
- JWT auth, no server-side session store
- Redis balance caching
- Idempotency keys on expense/settlement writes (prevents duplicate data under
  retry storms, cheap to add now)
- DB indexes on known hot query patterns
- Object storage (not local disk) for receipt images, once receipt scanning ships
  (v1+) — planned now so the backend VM never becomes a storage bottleneck later
- CDN for static frontend assets (Vercel gives this automatically)

**Deliberately deferred until there's an actual spike (don't build pre-emptively):**
- Background job queue (BullMQ on the existing Redis instance) — introduce this
  at v1 when receipt OCR, PDF export, and async AI calls exist; not needed when
  v0's only async-ish thing is a single lightweight Groq call.
- Load balancer / multiple backend instances — trivial to add later because the
  app is already stateless; not needed for 10–20 users.
- Postgres read replica — add when read load actually becomes the bottleneck.
- PgBouncer / connection pooling — add when concurrent connection count actually
  approaches limits.

This two-tier list (build now vs defer) is the actual scale story: nothing in the
data model or API contract needs to change when the "defer" list eventually gets
turned on — it's an infrastructure knob, not a rewrite.

## 9. API Design Principles

- REST, versioned implicitly by being additive — new fields and new endpoints are
  added for new tiers; existing v0 endpoints are not broken by later work. If an
  endpoint's contract must change incompatibly, that's a signal to add a new
  endpoint, not mutate the old one out from under existing frontend code.
- Every write endpoint (`POST /expenses`, `POST /settlements`) accepts an
  idempotency key from day one, even though v0 has low concurrent-retry risk —
  this is a cheap-now, expensive-later decision (§8).
- Balance endpoints (`GET /users/me/balance`, `GET /groups/:id/balance`) are the
  only endpoints with a caching layer in v0. Everything else reads from Postgres
  directly at this scale — no premature caching elsewhere.

## 10. Security & Trust Boundaries

- The entire group-joining trust model is **"whoever has the link/QR is trusted
  to join."** There is no friend-search, no social graph, no request/accept flow.
  This was a deliberate simplification (see `Usecase_Flow.md` for the reasoning)
  — it removes an entire class of identity-confusion bugs, and the link itself
  functions as the trust boundary (if you sent it to the right people, the right
  people are in the group).
- Invite links are tokenized (`invite_token`) with an expiry
  (`invite_token_expires_at`) and are revocable/regeneratable per group — this is
  in the v0 schema from day one (see `DB_Design.md` §3), even though the UI for
  "revoke and regenerate" may not be built until it's needed.
- JWT access tokens are short-lived; refresh tokens are stored as httpOnly cookies,
  never in localStorage (standard XSS-mitigation practice).
- No PII beyond what's needed is ever sent to the AI provider. Aggregated spend
  stats sent for summary generation are the minimum necessary fields, never raw
  user records.

## 11. What Explicitly Is NOT Built at the Architecture Level (Yet)

Mirrors `ProductDetailIDEA.md` §7, stated here in technical terms so it isn't
accidentally reintroduced mid-build:
- No payment processing / PCI-scope code, ever, unless explicitly revisited.
- No server-side session store — if a future requirement seems to need one, that's
  a signal to reconsider, not silently add one back.
- No native mobile codebase (React Native / Swift / Kotlin) at v0 or v1. Capacitor
  wrap around the existing Next.js PWA is the only planned native path, and only
  if App Store presence becomes a real requirement later.
- No microservices split. This is a single Node/Express backend against a single
  Postgres instance for the entire versioned roadmap described in
  `ProgressTracker.md`. Reconsider only if a specific, real bottleneck demands it
  — not preemptively.

## 12. Cross-References

- Full schema: `DB_Design.md`
- Product reasoning behind every constraint above: `ProductDetailIDEA.md`
- Concrete scenarios exercising this architecture: `Usecase_Flow.md`
- Stage-by-stage build order that implements this architecture: `AI_Prompts.md`
- What's built so far, what stage we're at: `ProgressTracker.md`