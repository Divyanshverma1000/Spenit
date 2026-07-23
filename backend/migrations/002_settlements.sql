-- Migration 002: Add upi_id to User table + create Settlement table
-- Stage 5 — Settlement Flow

-- Add upi_id to User (for UPI deep link generation)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS upi_id text null;

-- Settlement table (DB_Design.md §5)
CREATE TABLE IF NOT EXISTS "Settlement" (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references "Group"(id),
  from_user      uuid not null references "User"(id),
  to_user        uuid not null references "User"(id),
  amount         numeric(12,2) not null,
  method         text not null default 'upi',   -- 'upi' | 'cash' | 'other'
  status         text not null default 'pending', -- 'pending' | 'confirmed' | 'rejected'
  initiated_by   uuid not null references "User"(id),
  confirmed_by   uuid null references "User"(id),
  created_at     timestamptz default now(),
  confirmed_at   timestamptz null,
  deleted_at     timestamptz null,
  CONSTRAINT settlement_method_check CHECK (method IN ('upi', 'cash', 'other')),
  CONSTRAINT settlement_status_check CHECK (status IN ('pending', 'confirmed', 'rejected'))
);

-- Indexes for hot queries (DB_Design.md §8 pattern)
CREATE INDEX IF NOT EXISTS idx_settlement_group_id ON "Settlement"(group_id);
CREATE INDEX IF NOT EXISTS idx_settlement_group_status ON "Settlement"(group_id, status);
CREATE INDEX IF NOT EXISTS idx_settlement_from_user ON "Settlement"(from_user);
CREATE INDEX IF NOT EXISTS idx_settlement_to_user ON "Settlement"(to_user);
