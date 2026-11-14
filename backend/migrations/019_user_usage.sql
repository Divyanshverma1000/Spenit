-- 019_user_usage.sql — per-person daily AI counters for the admin People view
-- (screenshots read, chat questions). Counts only, no content.

create table if not exists "UserUsageDaily" (
  user_id uuid   not null references "User"(id) on delete cascade,
  day     date   not null,
  metric  text   not null,
  count   bigint not null default 0,
  primary key (user_id, day, metric)
);
