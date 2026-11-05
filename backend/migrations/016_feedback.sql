-- 016_feedback.sql — "Report a problem / share an idea" from Profile, read on /admin.
create table if not exists "Feedback" (
  id          bigserial   primary key,
  user_id     uuid        null references "User"(id) on delete set null,
  kind        text        not null default 'problem',   -- 'problem' | 'idea' | 'other'
  message     text        not null,
  page        text        null,
  app_version text        null,
  device      text        null,
  status      text        not null default 'new',       -- 'new' | 'done'
  created_at  timestamptz not null default now()
);
create index if not exists idx_feedback_created on "Feedback"(created_at desc);
