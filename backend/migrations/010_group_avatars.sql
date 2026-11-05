-- Group avatars + uploaded profile photos.
--
-- An avatar is chosen per group (GroupMember.avatar_key, one of the illustrated set in
-- frontend/public/avatars). Within a group each avatar can belong to one person only, so
-- two people never look the same. No avatar chosen → the profile photo, else coloured initials.
ALTER TABLE "GroupMember"
  ADD COLUMN IF NOT EXISTS avatar_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_groupmember_group_avatar
  ON "GroupMember" (group_id, avatar_key)
  WHERE avatar_key IS NOT NULL;

-- A photo uploaded in Profile (small, resized on the phone). "User".avatar_url then points
-- at GET /users/:id/photo. Kept out of "User" so member lists stay small.
CREATE TABLE IF NOT EXISTS "UserPhoto" (
  user_id    uuid        PRIMARY KEY REFERENCES "User"(id),
  mime       text        NOT NULL,
  data       text        NOT NULL, -- base64
  updated_at timestamptz NOT NULL DEFAULT now()
);
