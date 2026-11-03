-- Durable idempotency for POST /expenses.
--
-- The offline outbox retries requests with the same Idempotency-Key. Keeping the key in
-- Postgres (inside the same transaction that creates the expense) means a retry can never
-- create a duplicate, even after the server restarts or spins down, and it needs no Redis.
CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
  user_id    uuid        NOT NULL REFERENCES "User"(id),
  key        text        NOT NULL,
  response   jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON "IdempotencyKey" (created_at);
