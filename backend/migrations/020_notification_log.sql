-- 020_notification_log.sql — every push notification Spenit tried to send, and what happened,
-- so "did that notification go out?" has an answer. Titles only, never the message body.
-- Kept 30 days (housekeeping).

create table if not exists "NotificationLog" (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  user_id    uuid not null references "User"(id) on delete cascade,
  title      text not null,
  tag        text null,
  devices    int not null default 0,   -- subscriptions found for the person
  delivered  int not null default 0,   -- accepted by the push service
  failed     int not null default 0,
  removed    int not null default 0,   -- subscriptions that were gone (410/404) and got deleted
  error      text null
);
create index if not exists idx_notification_log_created on "NotificationLog"(created_at desc);
