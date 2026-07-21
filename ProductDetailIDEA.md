# Product Detail & Idea
### The core thinking document — read this first, always

This document exists so that anyone (or any AI) picking up this project — today, at
stage 8, or at stage 30 — understands **why this app exists, what problem it solves,
and what it deliberately refuses to become.** Every other document builds on top of
the decisions made here. If a future feature request conflicts with something in
this document, that conflict should be surfaced and resolved explicitly, not quietly
overridden.

---

## 1. The Problem

Splitwise (and clones like it) are the default tool for splitting shared expenses in
friend groups, roommates, and trips. They work, but they have a specific, consistent
failure mode: **they show you data, not an answer.**

Concretely:
- Balances are shown as a running ledger of transactions you have to mentally sum.
- Group balances and 1:1 friend balances live in separate views — there's no single
  "here's your total exposure right now" number.
- Settlement is a manual "record a payment" step that's easy to forget, so balances
  quietly go stale and trust in the app erodes.
- There's no AI/natural-language layer — every expense is a manual form-fill, every
  time, no matter how repetitive.
- The free tier is intentionally hobbled (historically, ads, capped simplified
  debts) to push a paid tier, so the free experience feels deliberately worse than
  it needs to be.

None of these are hard problems. They're just product decisions Splitwise made years
ago and never revisited. That's the opening.

## 2. The Thesis

> **Splitwise shows you the history. We show you the answer.**

Every core screen in this app should answer "who owes whom, and how much, right now"
in under 2 seconds — with the full transaction ledger available as an optional
drill-down, never as the default view.

Splitting is the **wedge feature** — it's what gets a group of friends to install
the app instead of Splitwise. What makes them **stay** is:
1. The net-balance-first UI (the answer, not the ledger)
2. AI-assisted expense entry (type or speak it, don't form-fill it)
3. UPI-native settlement (one tap into GPay/PhonePe/Paytm/BHIM, not a generic
   "mark as paid" button)
4. A debt-simplification algorithm that's surfaced and explained, not buried

## 3. Who This Is For

- **Primary (launch) audience:** a real friend group of 10–20 people (v0 — see
  `ProgressTracker.md` for what "v0" means concretely). This is not a hypothetical
  user — it's an actual group of people the builder knows, which is why v0 is scoped
  the way it is: build for real, immediate feedback, not for a hypothetical public
  launch.
- **Later audience (v1+):** India-first public audience (UPI-native), with a
  same-mechanism fallback for US users (Venmo/PayPal deep links) since the builder
  also has a US-audience content brand (Silenor) that could plausibly cross-promote
  later. This is *not* a commitment to a US launch — it's just why the payment
  abstraction is built provider-agnostic from day one.
- **Explicitly not the audience (ever, unless revisited deliberately):** people who
  want a full budgeting/accounting suite (YNAB-style). This app is a splitting +
  cash-flow-clarity tool, not a personal finance suite. Scope creep in this direction
  is the single easiest way to make this app as cluttered as the thing it's trying
  to replace.

## 4. What We Are Building (Plain Description)

A cross-platform (web-first, installable PWA) cash-flow and expense-splitting app
where:
- Groups are formed via a shareable link + QR code — no friend search, no social
  graph, no "which Prashant is this."
- Expenses can be typed or spoken in natural language ("Dinner 900, Rahul paid,
  split among 5") and an AI layer (Groq, initially free-tier) parses this into
  structured data, shown as an editable confirm-card before saving — **the AI never
  silently commits money math**, the user always sees and can correct the parse.
- The core screen is a **net balance** — one number per person, one number per
  group, one number across all groups — never a raw transaction feed as the
  default.
- Settling up runs a debt-simplification algorithm first (minimum number of
  payments to clear a group), explains the result in plain language, then generates
  a UPI (or Venmo, for US users) deep link for the actual payment, followed by a
  two-way confirmation so balances never go stale silently.
- The app is free at the core, forever — monetization (later, v1+/Tier 3) comes
  from an optional Pro tier (AI analytics, exports, advanced budgeting) and
  donations, never ads, never artificial caps on basic splitting.

## 5. Why AI, and What Role It Plays (Important Architectural Principle)

**The AI is a parser and a phraser. It is never a source of truth for money.**

This principle is repeated in `arch.md` because it drives real code structure, but
it starts here because it's a product decision, not just a technical one:

- All balance math (who owes whom, how much) is computed **deterministically** in
  the backend — plain arithmetic, fully unit-testable, zero AI involvement.
- AI's only two jobs:
  1. **Input parsing**: unstructured input (typed/spoken text, a receipt photo) →
     structured data (amount, payer, participants, split type).
  2. **Output phrasing**: structured data your backend already computed correctly →
     friendly natural-language explanation ("Instead of 4 payments, only 2 are
     needed").
- The AI is never allowed to invent a number. If a conversational "ask your ledger"
  feature answers "how much do I owe Aman," the backend runs the actual query first,
  and the AI only phrases that pre-computed, already-correct number.

This is what makes the AI features trustworthy rather than a gimmick, and it's also
what keeps Groq free-tier usage cheap — prompts stay small and structured rather
than needing the model to "think" about money.

## 6. Why Web-First (Next.js PWA), Not Native

- One codebase, no app store gatekeeping, testable instantly via a URL on both
  laptop and phone.
- Installable to the home screen (PWA) on both iOS and Android — "works on iOS and
  Android" is true from day one without writing separate native code.
- A clear native path later: if App Store presence becomes genuinely necessary
  (better push reliability, App Store discoverability), Capacitor can wrap this same
  Next.js codebase into an iOS/Android binary with minimal rework. Nothing built now
  is wasted if that decision is made later — this is *why* the PWA-first choice is
  safe, not a hedge that compromises v0.
- Known, accepted limitation: iOS web push only works after the user installs the
  PWA to their home screen (iOS 16.4+). This is treated as a documented constraint
  and part of the onboarding flow ("install the app" is a real, expected step), not
  a bug to be surprised by later.

## 7. What This App Deliberately Does NOT Do (And Why)

Stating cuts explicitly so scope doesn't creep back in mid-build. See
`ProgressTracker.md` for the phase-by-phase version of this list.

- **No in-app payment processing.** Deep-links only (UPI/Venmo), forever, unless a
  real business case for PCI-scope work emerges much later. This keeps the app out
  of financial-license and compliance complexity entirely.
- **No full budgeting/accounting suite.** Subscription tracking and trip budgets
  (later tiers) are the ceiling for "budgeting" features. This is not YNAB.
- **No native app at launch.** PWA only. Capacitor wrap is a future option, not a v0
  or v1 concern.
- **No social feed / public sharing outside a group.** No discovery, no public
  profiles, no feed. The trust boundary of the entire app is "who has this link" —
  that's a deliberate simplicity choice, not a missing feature.
- **No friend-search / social graph.** This was considered and explicitly rejected
  (see `Usecase_Flow.md` for the reasoning) — it introduces identity-confusion bugs
  ("which Prashant") for zero real benefit over link/QR-based group joining.
- **Business/restaurant QR mode** (a table QR → guests join → auto-split → merchant
  subscription) is a plausible future product, but it is explicitly **not part of
  the same build track** as this consumer app. If pursued, it gets its own spec,
  its own document set, and is treated as a separate product surface.

## 8. The Versioning Philosophy

This project is being built in deliberately small, real, shippable slices — not one
big-bang launch. The philosophy:

- **v0 ("Friends")**: built for an actual 10–20 person friend group, Google-only
  auth, Equal/Exact splits only, one AI feature (natural-language entry), minimal
  infra (one VM, one Postgres, one Redis, no job queue). Goal: real daily usage,
  real feedback, proof that the net-balance-first UI actually feels better than
  Splitwise to real people. Nothing in v0 is thrown away later — every table, every
  API contract, is designed to be **extended**, not replaced, by v1 and beyond. See
  `DB_Design.md` for exactly how this forward-compatibility is engineered into the
  schema from day one.
- **v1 (public Tier 0)**: adds email/OTP auth, percentage/share/itemized splits,
  multi-payer, data export, cross-group dashboard polish — the full "genuinely
  better than Splitwise" MVP bar.
- **v1.x / Tier 1**: receipt scanning + OCR, recurring expenses, smart contextual
  reminders, AI monthly insights, multi-currency.
- **Tier 2**: Trip Mode, subscription sharing, group templates, conversational
  ledger assistant, expense timeline/feed view.
- **Tier 3**: Pro subscription, donations, business/restaurant mode (separate
  product surface), referrals, group leaderboards.

The rule that makes this safe: **because the DB schema and API contracts are
planned for all tiers from day one (see `DB_Design.md`), moving from v0 → v1 → Tier
2 is additive work, not a rewrite.** This is the single most important engineering
discipline on this project, and it's why the schema document is as detailed as it
is even though most of its tables are unused in v0.

## 9. The "Why Switch From Splitwise" Pitch (Final, for Onboarding Copy)

1. **Net balance first** — the answer, not a transaction ledger you have to sum
   yourself.
2. **AI-assisted entry** — type or speak an expense instead of filling a form.
3. **UPI-native settlement** — one tap into GPay/PhonePe/Paytm/BHIM, not a generic
   "record a payment" form.
4. **Debt simplification**, surfaced and explained in plain language, not buried.
5. **Trip Mode** (later tier) — one workspace for the whole trip, not just an
   expense list.
6. **Fully free core**, monetized via Pro/donations later, never ads, never
   artificial caps.
7. **Installs instantly from a link** (PWA) — no app store friction to onboard
   friends.

## 10. How To Use This Document Set

This document is the "why." The other documents in this project root are the "how"
and the "what, exactly":

- `Architecture.md` — system design, tech stack, and every technical decision, with
  reasoning.
- `DB_Design.md` — the full database schema, planned across all future versions,
  with a clear marker for what's active in v0 vs dormant-but-planned for later.
- `Usecase_Flow.md` — real scenario walkthroughs showing how the app is actually
  used, feature by feature, so the "why this is better than Splitwise" claim is
  concrete, not abstract.
- `ProgressTracker.md` — the living log of what's been built, what stage the
  project is at, and what's next. This file is updated by the AI at the end of
  every work session.
- `AI_Prompts.md` — the staged build prompts, including the context-loading block
  used to re-orient any AI tool (Cursor/Trae/Antigravity/Claude) when switching
  tools or resuming after a break.

When in doubt about a product decision, this document wins. When in doubt about a
technical decision, `Architecture.md` wins. When in doubt about what data a table
needs, `DB_Design.md` wins.