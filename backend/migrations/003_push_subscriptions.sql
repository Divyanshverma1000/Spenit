-- Migration 003: PushSubscription table (Stage 7 — Web Push Notifications)
--
-- A user can have multiple push subscriptions (one per browser/device).
-- The endpoint is the unique identifier for a subscription.

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references "User"(id) on delete cascade,
  -- The full Web Push subscription object serialised as JSON:
  --   { endpoint, expirationTime, keys: { p256dh, auth } }
  endpoint      text not null unique,
  p256dh        text not null,  -- client public key (base64url)
  auth          text not null,  -- client auth secret (base64url)
  user_agent    text null,      -- stored for debugging; which device/browser
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Fast lookup of all subscriptions for a given user
CREATE INDEX IF NOT EXISTS idx_push_subscription_user_id ON "PushSubscription"(user_id);

-- Unique on endpoint — prevents duplicate rows per device
-- (already enforced by the UNIQUE constraint above, index created implicitly)
