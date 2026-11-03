-- Group nicknames + placeholder ("not joined yet") members.
--
-- A placeholder is a real "User" row with is_placeholder = true and no google_id.
-- Keeping them in "User" means ExpensePayer / ExpenseSplit / Settlement keep working
-- unchanged. When the real person joins and claims a placeholder, all rows that point
-- at the placeholder are re-pointed to the real user (see POST /groups/join/:token).

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

ALTER TABLE "GroupMember"
  ADD COLUMN IF NOT EXISTS nickname text NULL,
  ADD COLUMN IF NOT EXISTS added_by uuid NULL REFERENCES "User"(id);

-- A nickname is unique within a group (case-insensitive). Display name is
-- COALESCE(nickname, "User".name).
CREATE UNIQUE INDEX IF NOT EXISTS idx_groupmember_group_nickname
  ON "GroupMember" (group_id, lower(nickname))
  WHERE nickname IS NOT NULL;
