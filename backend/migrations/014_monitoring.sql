-- 014_monitoring.sql — what the admin dashboard and error alerts read.
-- No personal content: ids, counts and error summaries only. Days are India time (IST).

-- Who is using the app: last request time, and one row per person per day they used it.
alter table "User" add column if not exists last_seen_at timestamptz null;
create table if not exists "UserActiveDay" (
  user_id uuid not null references "User"(id) on delete cascade,
  day     date not null,
  primary key (day, user_id)
);

-- Daily counters for things not already in other tables (AI calls and tokens, chat questions).
create table if not exists "UsageDaily" (
  day    date   not null,
  metric text   not null,
  count  bigint not null default 0,
  primary key (day, metric)
);

-- Errors, grouped: one row per kind of error per day, with how often it happened.
create table if not exists "ErrorDaily" (
  day         date        not null,
  fingerprint text        not null,
  source      text        not null,   -- 'api' | 'app'
  message     text        not null,
  path        text        null,
  count       integer     not null default 0,
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  primary key (day, fingerprint)
);
create index if not exists idx_error_daily_last on "ErrorDaily"(last_at desc);
