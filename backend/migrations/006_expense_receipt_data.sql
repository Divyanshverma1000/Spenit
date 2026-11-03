-- Backfill: receipt_data was added to 001 after some databases were already created.
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS receipt_data jsonb NULL;
