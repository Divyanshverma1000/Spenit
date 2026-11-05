-- 011_group_safety.sql — undoable claims, leaving a group, and an activity log.
-- Additive and idempotent (applied by the Worker itself, see src/db/workerMigrations.ts).

-- Every time someone joins as a placeholder ("I'm Sourabh"), what was moved to them,
-- so a wrong pick can be undone exactly.
create table if not exists "MemberClaim" (
  id                     uuid        primary key default gen_random_uuid(),
  group_id               uuid        not null references "Group"(id),
  placeholder_id         uuid        not null references "User"(id),
  claimed_by             uuid        not null references "User"(id),
  placeholder_nickname   text        null,
  placeholder_avatar_key text        null,
  placeholder_joined_at  timestamptz null,
  -- { "payerExpenses": [...], "splitExpenses": [...], "createdExpenses": [...],
  --   "receiptExpenses": [...], "settlements": { "from_user": [...], ... } }
  moved                  jsonb       not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  undone_at              timestamptz null,
  undone_by              uuid        null references "User"(id)
);
create index if not exists idx_member_claim_group on "MemberClaim"(group_id, created_at desc);
create index if not exists idx_member_claim_user on "MemberClaim"(claimed_by) where undone_at is null;

-- Everything that changes money or membership in a group, for everyone in it to see.
create table if not exists "GroupActivity" (
  id            bigserial   primary key,
  group_id      uuid        not null references "Group"(id),
  actor_id      uuid        null references "User"(id),
  kind          text        not null,
  expense_id    uuid        null,
  settlement_id uuid        null,
  target_user   uuid        null,
  -- names, amounts and before/after snapshots, copied at the time (people may leave later)
  summary       jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_group_activity_group on "GroupActivity"(group_id, created_at desc, id desc);
