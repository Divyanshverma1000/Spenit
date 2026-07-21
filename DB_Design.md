# Database Design
### The full schema, planned across every future version — this document is the "what, exactly"

**Rule for this document:** every table below is designed now, even if it isn't
created by the v0 migration. Tables are marked `[V0 — ACTIVE]`, `[V1 — PLANNED]`,
`[TIER 1 — PLANNED]`, `[TIER 2 — PLANNED]`, or `[TIER 3 — PLANNED]`. When a later
stage in `AI_Prompts.md` says "add table X," the definition here is the one to
implement — this document should not need to be redesigned, only extended, as the
project moves through stages. If a stage ever needs a field that isn't here, that's
a signal to update this document deliberately (and note it in
`ProgressTracker.md`), not to freehand a column into a migration.

---

## 1. Core Design Principles (Apply to Every Table, Every Version)

1. **`id` is always the foreign-key source of truth.** Never join on `name` or any
   human-readable field.
2. **Balances are never stored.** There is no `balance` column anywhere, ever. All
   balance figures are computed at read-time from `Expense` + `ExpensePayer` +
   `ExpenseSplit` + `Settlement`. See `Architecture.md` §3.
3. **Soft-delete only** on `Expense`, `Settlement`, and `Group` — an `deleted_at
   timestamptz null` column, never a hard `DELETE`. Protects the audit trail and
   the derived-balance principle.
4. **Append-only ledger tables.** `Expense` and `Settlement` rows are never
   mutated after creation except for status/confirmation fields explicitly meant
   to change (e.g. `Settlement.status`). If an expense is wrong, it's corrected by
   a new adjusting entry or a soft-delete + recreate, not an in-place edit of the
   amount — this preserves the audit trail.
5. **Timestamps**: every table gets `created_at timestamptz default now()`.
   Mutable-status tables also get `updated_at`.
6. **UUIDs for primary keys** (`id uuid primary key default gen_random_uuid()`)
   everywhere — avoids sequential-ID enumeration issues and makes eventual
   multi-region/replica work trivial if it's ever needed (it won't be needed at
   v0/v1 scale, but it costs nothing to choose UUIDs now).

---

## 2. Identity: `User` — `[V0 — ACTIVE]`

This is the table most likely to bite you later if under-designed now, so it's
worth explaining in full before showing the schema.

**The problem:** `name` alone is a display label, not an identifier. It breaks the
moment a group has two "Prashant"s — both for the AI natural-language parser
(which needs to disambiguate "split with Prashant and Prashant") and for the
manual participant-picker UI.

**The fix:** add `username` — unique, used for identity/disambiguation/mentions —
while `name` stays as a freely-editable, possibly-colliding display label.

```sql
User [V0 — ACTIVE]
  id                  uuid primary key default gen_random_uuid()
  username            text unique not null   -- auto-generated at signup for v0
                                              -- (firstname -> firstname2 on collision),
                                              -- editable later in profile settings
  name                text not null           -- display name, NOT unique, purely cosmetic
  email               text unique             -- from Google profile
  google_id           text unique             -- v0: Google-only auth
  password_hash       text null               -- [V1 — PLANNED] populated once email/OTP auth ships;
                                              -- null for all Google-only v0 users
  upi_id              text null               -- for settlement deep-links
  venmo_handle        text null               -- [V1 — PLANNED] for US-audience settlement fallback
  avatar_url          text null
  created_at          timestamptz default now()
  updated_at          timestamptz default now()
  deleted_at          timestamptz null        -- soft-delete
```

**Where `username` actually matters in the app (from `Usecase_Flow.md`):**
- AI natural-language entry: if a group has duplicate `name`s, the parser and the
  manual participant-picker show `Prashant K. (@prashant.k)` /
  `Prashant S. (@prashant.s)` instead of two identical "Prashant" strings.
- If `name` doesn't collide within a group, the UI just shows `name` — no need to
  clutter the interface with `@handles` by default. Collision-detection is a
  simple query-time check within the group's member list, not a stored flag.
- Settlement/UPI flow: `username` is a stable reference key even if a user later
  changes their display `name`.

**v0 decision, made explicit:** `username` is **auto-generated** at signup
(`firstname` → `firstname2` on collision) and editable later in profile settings.
Self-chosen usernames (like Instagram handles, with real-time uniqueness
validation UI) were considered and explicitly deferred — that's more UI work than
a 10–20 person friend-group launch needs. This can change at v1 without a schema
migration (the column and its uniqueness constraint are already correct); it's
purely a signup-flow UI decision to revisit later.

---

## 3. Groups: `Group`, `GroupMember` — `[V0 — ACTIVE]`

```sql
Group [V0 — ACTIVE]
  id                        uuid primary key default gen_random_uuid()
  name                      text not null
  icon                      text null              -- emoji or icon identifier for v0; [TIER 2] may become an image URL for Trip Mode covers
  invite_token              text unique not null   -- the shareable link's token
  invite_token_expires_at   timestamptz null        -- null = no expiry; settable for a "revoke and regenerate" flow
  created_by                uuid not null references "User"(id)
  created_at                timestamptz default now()
  updated_at                timestamptz default now()
  deleted_at                timestamptz null        -- soft-delete

GroupMember [V0 — ACTIVE]
  group_id      uuid not null references "Group"(id)
  user_id       uuid not null references "User"(id)
  role          text not null default 'member'  -- 'member' | 'admin' — admin can regenerate/revoke invite_token
  joined_at     timestamptz default now()
  primary key (group_id, user_id)
```

**Design notes:**
- `invite_token` + `invite_token_expires_at` exist in the schema from v0 even if
  the "revoke and regenerate" UI isn't built until it's actually needed — this is
  a cheap-now field, expensive-to-retrofit-securely later.
- No `Friendship` table exists anywhere in this schema, by design. See
  `Usecase_Flow.md` Scenario C for the full reasoning — the group link/QR *is*
  the entire trust and identity-resolution model. Do not add a friend-graph table
  without first revisiting that design decision explicitly.
- `icon` is a plain string in v0/v1. It's designed to be reinterpretable as an
  image URL for Tier 2 Trip Mode covers without a schema change — just a change
  in what the frontend does with the string.

---

## 4. Expenses & Splits — `[V0 — ACTIVE, with TIER 1 extension points marked]`

```sql
Expense [V0 — ACTIVE]
  id             uuid primary key default gen_random_uuid()
  group_id       uuid not null references "Group"(id)
  description    text not null
  amount         numeric(12,2) not null
  currency       text not null default 'INR'    -- [V1 — PLANNED] multi-currency FX conversion uses this; v0 always 'INR'
  split_type     text not null                  -- v0: 'equal' | 'exact'
                                                 -- [V1 — PLANNED] adds: 'percentage' | 'share'
                                                 -- [TIER 1 — PLANNED] adds: 'itemized'
  category       text null                      -- [TIER 1 — PLANNED] smart categorization; null in v0
  receipt_url    text null                      -- [TIER 1 — PLANNED] object storage URL once receipt scanning ships
  is_recurring   boolean not null default false -- [TIER 1 — PLANNED] always false in v0
  recurrence_rule jsonb null                     -- [TIER 1 — PLANNED] e.g. {"frequency":"monthly","day_of_month":1}
  created_by     uuid not null references "User"(id)
  created_at     timestamptz default now()
  updated_at     timestamptz default now()
  deleted_at     timestamptz null                -- soft-delete; NEVER hard-delete an expense

ExpensePayer [V0 — ACTIVE]
  expense_id     uuid not null references "Expense"(id)
  user_id        uuid not null references "User"(id)
  amount_paid    numeric(12,2) not null
  primary key (expense_id, user_id)
  -- supports multi-payer expenses from v0: sum(amount_paid) across rows == Expense.amount

ExpenseSplit [V0 — ACTIVE]
  expense_id     uuid not null references "Expense"(id)
  user_id        uuid not null references "User"(id)
  share_amount   numeric(12,2) not null
  primary key (expense_id, user_id)
  -- sum(share_amount) across rows == Expense.amount; this is the table balance computation reads from
```

**Tier 1 extension tables (designed now, not created until Tier 1 build stage):**

```sql
ExpenseItem [TIER 1 — PLANNED]
  id             uuid primary key default gen_random_uuid()
  expense_id     uuid not null references "Expense"(id)
  name           text not null            -- e.g. "Butter chicken"
  amount         numeric(12,2) not null
  created_at     timestamptz default now()

ExpenseItemAssignment [TIER 1 — PLANNED]
  expense_item_id  uuid not null references "ExpenseItem"(id)
  user_id          uuid not null references "User"(id)
  share_amount     numeric(12,2) not null  -- item cost divided among assigned users
  primary key (expense_item_id, user_id)
  -- when this table has rows for an Expense, split_type = 'itemized' and
  -- ExpenseSplit rows are DERIVED from summing these + proportional tax/service,
  -- not entered separately -- this keeps the single balance-computation
  -- code path (reading ExpenseSplit) unchanged even for itemized splits

Category [TIER 1 — PLANNED]
  id             uuid primary key default gen_random_uuid()
  name           text not null unique     -- 'Food', 'Travel', 'Rent', 'Utilities', etc.
  icon           text null

MerchantCategoryCache [TIER 1 — PLANNED]
  merchant_name_normalized  text primary key   -- e.g. "zomato"
  category_id               uuid not null references "Category"(id)
  updated_at                timestamptz default now()
  -- avoids re-calling the AI model for the same merchant every time; a pure
  -- lookup cache, safe to be wrong occasionally and just re-populate
```

**Why `ExpenseItemAssignment` derives into `ExpenseSplit` rather than replacing
it:** the balance-computation code path (see `Architecture.md` §3) always reads
from `ExpenseSplit`. Itemized splitting is a *different way of arriving at* the
same `ExpenseSplit` rows (via per-item assignment + proportional tax/service
distribution), not a different computation path. This is precisely the kind of
forward-compatibility this document is meant to guarantee — Tier 1's itemized
splitting doesn't touch the balance engine at all, it just adds a new way to
populate `ExpenseSplit`.

---

## 5. Settlements — `[V0 — ACTIVE]`

```sql
Settlement [V0 — ACTIVE]
  id             uuid primary key default gen_random_uuid()
  group_id       uuid not null references "Group"(id)
  from_user      uuid not null references "User"(id)
  to_user        uuid not null references "User"(id)
  amount         numeric(12,2) not null
  method         text not null default 'upi'   -- 'upi' | 'venmo' | 'cash' | 'other'
  status         text not null default 'pending' -- 'pending' | 'confirmed' | 'rejected'
  initiated_by   uuid not null references "User"(id)
  confirmed_by   uuid null references "User"(id)
  created_at     timestamptz default now()
  confirmed_at   timestamptz null
  deleted_at     timestamptz null               -- soft-delete
```

**Design notes:**
- Two-way confirmation is modeled directly: `initiated_by` marks paid,
  `confirmed_by` + `status='confirmed'` is set only when the other party
  confirms. A balance only clears to zero once `status='confirmed'` — this is the
  schema-level enforcement of the "balances never silently go stale" principle
  from `ProductDetailIDEA.md`.
- `method` includes `'cash'`/`'other'` from v0 even though the UI's primary flow
  is UPI deep-links — this covers the "paid in cash and want to log it manually"
  case from `Usecase_Flow.md` Scenario A §6 without needing a schema change later.

---

## 6. Tier 2 Extension Tables — `[TIER 2 — PLANNED]`

Designed now so Tier 2 work is purely additive.

```sql
TripWorkspace [TIER 2 — PLANNED]
  id             uuid primary key default gen_random_uuid()
  group_id       uuid not null references "Group"(id) unique  -- one workspace per group, upgrade-in-place
  budget_amount  numeric(12,2) null
  start_date     date null
  end_date       date null
  created_at     timestamptz default now()

TripItineraryItem [TIER 2 — PLANNED]
  id             uuid primary key default gen_random_uuid()
  trip_workspace_id uuid not null references "TripWorkspace"(id)
  title          text not null
  scheduled_at   timestamptz null
  notes          text null

TripPoll [TIER 2 — PLANNED]
  id                 uuid primary key default gen_random_uuid()
  trip_workspace_id  uuid not null references "TripWorkspace"(id)
  question           text not null
  created_by         uuid not null references "User"(id)
  created_at         timestamptz default now()

TripPollOption [TIER 2 — PLANNED]
  id           uuid primary key default gen_random_uuid()
  trip_poll_id uuid not null references "TripPoll"(id)
  label        text not null

TripPollVote [TIER 2 — PLANNED]
  trip_poll_option_id uuid not null references "TripPollOption"(id)
  user_id              uuid not null references "User"(id)
  primary key (trip_poll_option_id, user_id)

Subscription [TIER 2 — PLANNED]
  id             uuid primary key default gen_random_uuid()
  group_id       uuid not null references "Group"(id)
  name           text not null              -- 'Netflix', 'Spotify', etc.
  amount         numeric(12,2) not null
  billing_cycle  text not null              -- 'monthly' | 'yearly'
  renews_on      date not null
  created_by     uuid not null references "User"(id)
  created_at     timestamptz default now()
```

---

## 7. Tier 3 Extension Tables — `[TIER 3 — PLANNED]`

```sql
ProSubscription [TIER 3 — PLANNED]
  id             uuid primary key default gen_random_uuid()
  user_id        uuid not null references "User"(id) unique
  plan           text not null              -- 'monthly' | 'yearly'
  status         text not null              -- 'active' | 'cancelled' | 'expired'
  started_at     timestamptz default now()
  expires_at     timestamptz null

Referral [TIER 3 — PLANNED]
  id               uuid primary key default gen_random_uuid()
  referrer_user_id uuid not null references "User"(id)
  referred_user_id uuid not null references "User"(id) unique
  created_at       timestamptz default now()
```

Business/restaurant QR mode (Tier 3) is explicitly **not** designed here — per
`ProductDetailIDEA.md` §7, it's a separate product surface with its own future
spec if pursued, not an extension of this schema.

---

## 8. Indexes (From Day One — Cheap Now, Painful to Discover Missing Under Load)

```sql
-- v0, created with the initial migration:
create index on "GroupMember" (user_id);
create index on "Expense" (group_id, created_at);
create index on "Settlement" (group_id, status);
create index on "ExpensePayer" (user_id);
create index on "ExpenseSplit" (user_id);
create unique index on "User" (username);
create unique index on "User" (email);
create unique index on "Group" (invite_token);
```

## 9. What's Deliberately NOT in the Schema (And Why)

- **No `Friendship` / friend-graph table**, at any tier currently planned. See
  `Usecase_Flow.md` Scenario C.
- **No `balance` column**, anywhere, ever. See §1 and `Architecture.md` §3.
- **No currency/FX table in v0** — `Expense.currency` exists as a column from v0
  (defaulting to `'INR'`) so the field doesn't need to be added via migration
  later, but live FX conversion logic and any FX-rate-cache table are Tier 1 work,
  not v0 work.
- **No hard deletes anywhere on `Expense`, `Settlement`, or `Group`.** Soft-delete
  via `deleted_at` only, permanently, per §1.

## 10. v0 Migration Scope (What Actually Gets Created First)

For absolute clarity when a stage in `AI_Prompts.md` says "set up the database,"
these are the **only** tables the v0 migration creates:

```
User
Group
GroupMember
Expense
ExpensePayer
ExpenseSplit
Settlement
```

Everything else in this document is designed but dormant until its tier's build
stage explicitly says to create it.

## 11. Cross-Reference

- Why balances are computed this way: `Architecture.md` §3
- Why `username` exists alongside `name`: this document §2, and
  `Usecase_Flow.md` Scenario A §2
- Which stage creates which table: `AI_Prompts.md` / `ProgressTracker.md`