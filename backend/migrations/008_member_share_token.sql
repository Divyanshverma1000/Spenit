-- Per-member "what you owe" link: lets someone without the app (or not yet signed in)
-- open /owe/<share_token> and see what they owe plus prefilled UPI pay buttons.
ALTER TABLE "GroupMember"
  ADD COLUMN IF NOT EXISTS share_token text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_groupmember_share_token
  ON "GroupMember" (share_token)
  WHERE share_token IS NOT NULL;
