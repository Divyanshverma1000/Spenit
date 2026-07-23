-- =============================================================================
-- Spenit v0 Migration — 001_v0_schema.sql
-- Creates exactly the 7 tables listed in DB_Design.md §10, with all column
-- definitions from §2–§5 and all indexes from §8.
-- Table names are double-quoted to preserve case (User, Group are reserved words).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable pgcrypto for gen_random_uuid() (Postgres < 13 needs this; harmless on 13+)
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. User  [DB_Design.md §2]
-- ---------------------------------------------------------------------------
create table if not exists "User" (
  id              uuid        primary key default gen_random_uuid(),
  username        text        unique not null,
  name            text        not null,
  email           text        unique,
  google_id       text        unique,
  password_hash   text        null,      -- [V1 — PLANNED] null for all v0 Google users
  upi_id          text        null,
  venmo_handle    text        null,      -- [V1 — PLANNED]
  avatar_url      text        null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz null       -- soft-delete
);

-- ---------------------------------------------------------------------------
-- 2. Group  [DB_Design.md §3]
-- ---------------------------------------------------------------------------
create table if not exists "Group" (
  id                      uuid        primary key default gen_random_uuid(),
  name                    text        not null,
  icon                    text        null,
  invite_token            text        unique not null,
  invite_token_expires_at timestamptz null,
  created_by              uuid        not null references "User"(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz null       -- soft-delete
);

-- ---------------------------------------------------------------------------
-- 3. GroupMember  [DB_Design.md §3]
-- ---------------------------------------------------------------------------
create table if not exists "GroupMember" (
  group_id  uuid        not null references "Group"(id),
  user_id   uuid        not null references "User"(id),
  role      text        not null default 'member',  -- 'member' | 'admin'
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 4. Expense  [DB_Design.md §4]
-- ---------------------------------------------------------------------------
create table if not exists "Expense" (
  id              uuid           primary key default gen_random_uuid(),
  group_id        uuid           not null references "Group"(id),
  description     text           not null,
  amount          numeric(12,2)  not null,
  currency        text           not null default 'INR',   -- [V1 — PLANNED] multi-currency
  split_type      text           not null,                  -- 'equal' | 'exact'
  category        text           null,                      -- [TIER 1 — PLANNED]
  receipt_url     text           null,                      -- [TIER 1 — PLANNED]
  is_recurring    boolean        not null default false,    -- [TIER 1 — PLANNED]
  recurrence_rule jsonb          null,                      -- [TIER 1 — PLANNED]
  created_by      uuid           not null references "User"(id),
  created_at      timestamptz    not null default now(),
  updated_at      timestamptz    not null default now(),
  deleted_at      timestamptz    null                        -- soft-delete; NEVER hard-delete
);

-- ---------------------------------------------------------------------------
-- 5. ExpensePayer  [DB_Design.md §4]
-- ---------------------------------------------------------------------------
create table if not exists "ExpensePayer" (
  expense_id   uuid           not null references "Expense"(id),
  user_id      uuid           not null references "User"(id),
  amount_paid  numeric(12,2)  not null,
  primary key (expense_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 6. ExpenseSplit  [DB_Design.md §4]
-- ---------------------------------------------------------------------------
create table if not exists "ExpenseSplit" (
  expense_id    uuid           not null references "Expense"(id),
  user_id       uuid           not null references "User"(id),
  share_amount  numeric(12,2)  not null,
  primary key (expense_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 7. Settlement  [DB_Design.md §5]
-- ---------------------------------------------------------------------------
create table if not exists "Settlement" (
  id            uuid           primary key default gen_random_uuid(),
  group_id      uuid           not null references "Group"(id),
  from_user     uuid           not null references "User"(id),
  to_user       uuid           not null references "User"(id),
  amount        numeric(12,2)  not null,
  method        text           not null default 'upi',      -- 'upi' | 'venmo' | 'cash' | 'other'
  status        text           not null default 'pending',  -- 'pending' | 'confirmed' | 'rejected'
  initiated_by  uuid           not null references "User"(id),
  confirmed_by  uuid           null     references "User"(id),
  created_at    timestamptz    not null default now(),
  confirmed_at  timestamptz    null,
  deleted_at    timestamptz    null                          -- soft-delete
);

-- =============================================================================
-- Indexes  [DB_Design.md §8]
-- All 8 indexes listed in the spec, with explicit names for IF NOT EXISTS support.
-- =============================================================================
create index if not exists idx_groupmember_user_id   on "GroupMember"  (user_id);
create index if not exists idx_expense_group_created  on "Expense"      (group_id, created_at);
create index if not exists idx_settlement_group_status on "Settlement"   (group_id, status);
create index if not exists idx_expensepayer_user_id   on "ExpensePayer" (user_id);
create index if not exists idx_expensesplit_user_id   on "ExpenseSplit" (user_id);
create unique index if not exists idx_user_username   on "User"         (username);
create unique index if not exists idx_user_email      on "User"         (email);
create unique index if not exists idx_group_invite    on "Group"        (invite_token);
