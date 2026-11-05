-- 013_rate_counter.sql — exact counters for limits that must hold across every server
-- instance (AI calls cost money). One row per key per time window; old rows are deleted
-- by housekeeping.
create table if not exists "RateCounter" (
  key          text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (key, window_start)
);
create index if not exists idx_rate_counter_window on "RateCounter"(window_start);
