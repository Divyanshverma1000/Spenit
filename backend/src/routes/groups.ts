import { Router, Request, Response } from "express";
import crypto from "crypto";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { isAvatarKey } from "../lib/avatars";
import { invalidateGroupBalanceCache, getGroupBalance } from "./balance";
import { listGroupExpenses } from "./expenses";
import { listGroupSettlements } from "./settlements";
import {
  normalizeNickname,
  getMemberRole,
  isDisplayNameTaken,
  suggestNickname,
  transferUserReferences,
  userHasHistory,
} from "../lib/members";

const router = Router();

// ─── Token generation ─────────────────────────────────────────────────────────
// Uses Node's built-in crypto — no extra dependency needed.
// Produces a URL-safe 12-byte (16-char base64url) token.
function generateInviteToken(): string {
  return crypto.randomBytes(12).toString("base64url");
}

// ─── POST /groups ─────────────────────────────────────────────────────────────
/**
 * Create a new group.
 * - Generates a unique invite_token.
 * - Sets created_by to the authenticated user.
 * - Automatically adds the creator as a GroupMember with role 'admin'.
 *
 * Body: { name: string, icon?: string }
 * Auth: required
 */
router.post("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { name, icon, nickname: rawNickname } = req.body as { name?: string; icon?: string; nickname?: string };
  const nickname = normalizeNickname(rawNickname);

  if (!name || name.trim().length === 0) {
    res.status(400).json({ error: "Group name is required" });
    return;
  }

  const userId = req.user!.userId;

  // Generate a collision-resistant invite token
  let invite_token = generateInviteToken();

  // Extremely unlikely collision, but check and retry once
  const collision = await pool.query(
    'select 1 from "Group" where invite_token = $1',
    [invite_token]
  );
  if (collision.rows.length > 0) {
    invite_token = generateInviteToken();
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert the Group row (DB_Design.md §3)
    const { rows } = await client.query(
      `insert into "Group" (name, icon, invite_token, created_by)
       values ($1, $2, $3, $4)
       returning id, name, icon, invite_token, created_by, created_at`,
      [name.trim(), icon || null, invite_token, userId]
    );
    const group = rows[0];

    // Automatically add the creator as a GroupMember with role 'admin'
    await client.query(
      `insert into "GroupMember" (group_id, user_id, role, nickname)
       values ($1, $2, 'admin', $3)`,
      [group.id, userId, nickname]
    );

    await client.query("COMMIT");

    res.status(201).json({
      id: group.id,
      name: group.name,
      icon: group.icon,
      inviteToken: group.invite_token,
      createdBy: group.created_by,
      createdAt: group.created_at,
      memberCount: 1,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /groups error:", err);
    res.status(500).json({ error: "Failed to create group" });
  } finally {
    client.release();
  }
});

// ─── GET /groups ──────────────────────────────────────────────────────────────
/**
 * Return all groups the authenticated user belongs to, with member count.
 * Auth: required
 */
router.get("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  const { rows } = await pool.query(
    `select
       g.id,
       g.name,
       g.icon,
       g.invite_token,
       g.created_by,
       g.created_at,
       gm.role,
       gm.joined_at,
       (select count(*) from "GroupMember" gm2 where gm2.group_id = g.id)::int as member_count,
       (select coalesce(json_agg(p), '[]'::json) from (
          select u.id, coalesce(gm3.nickname, u.name) as name, u.avatar_url as "avatarUrl",
                 gm3.avatar_key as "avatarKey", u.is_placeholder as "isPlaceholder"
          from "GroupMember" gm3 join "User" u on u.id = gm3.user_id
          where gm3.group_id = g.id
          order by gm3.joined_at asc
          limit 4
        ) p) as members_preview
     from "Group" g
     join "GroupMember" gm on gm.group_id = g.id
     where gm.user_id = $1
       and g.deleted_at is null
     order by gm.joined_at desc`,
    [userId]
  );

  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      inviteToken: r.invite_token,
      createdBy: r.created_by,
      createdAt: r.created_at,
      role: r.role,
      joinedAt: r.joined_at,
      memberCount: r.member_count,
      /** first four members, for the avatar stack on group cards */
      members: r.members_preview,
    }))
  );
});

// ─── GET /groups/preview/:token ───────────────────────────────────────────────
/**
 * Public endpoint — NO auth required.
 * Returns just enough info to render the group preview page before sign-in.
 * Deliberately minimal: name + member count only (no member PII).
 *
 * This is the endpoint that powers the `/g/:token` preview page for
 * a user who hasn't signed in yet — per Usecase_Flow.md Scenario A §1.
 */
router.get("/preview/:token", async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;

  const { rows } = await pool.query(
    `select
       g.id,
       g.name,
       g.icon,
       g.invite_token_expires_at,
       (select count(*) from "GroupMember" gm where gm.group_id = g.id)::int as member_count
     from "Group" g
     where g.invite_token = $1
       and g.deleted_at is null`,
    [token]
  );

  if (rows.length === 0) {
    res.status(404).json({ error: "Invite link not found or expired" });
    return;
  }

  const group = rows[0];

  // Check token expiry (null = no expiry — most v0 groups)
  if (group.invite_token_expires_at && new Date(group.invite_token_expires_at) < new Date()) {
    res.status(410).json({ error: "Invite link has expired" });
    return;
  }

  // Placeholders the admin added who haven't joined yet — lets a joiner say
  // "I'm Rahul" and inherit the expenses already recorded for them.
  // Only admin-chosen nicknames are exposed, never ids of real members' data.
  const unclaimed = await pool.query(
    `select gm.user_id as id, coalesce(gm.nickname, u.name) as nickname
     from "GroupMember" gm
     join "User" u on u.id = gm.user_id
     where gm.group_id = $1 and u.is_placeholder = true
     order by gm.joined_at asc`,
    [group.id]
  );

  res.json({
    name: group.name,
    icon: group.icon,
    memberCount: group.member_count,
    unclaimedMembers: unclaimed.rows,
  });
});

// ─── POST /groups/join/:token ─────────────────────────────────────────────────
/**
 * Join a group using its invite token.
 * - Token-based join: the token IS the authorization (Usecase_Flow.md Scenario A §1 / Scenario C).
 * - If the user is already a member, returns 200 (idempotent — safe to call again after page refresh).
 * - NO friend-search, NO friend-request, NO Friendship table. The link IS the trust boundary.
 *
 * Auth: required (user must be signed in to join — if not, the preview page
 * redirects them to /auth first, then back to this token URL)
 */
router.post("/join/:token", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;
  const userId = req.user!.userId;
  const { nickname: rawNickname, claimMemberId } = (req.body || {}) as {
    nickname?: string;
    claimMemberId?: string;
  };
  const nickname = normalizeNickname(rawNickname);

  const { rows } = await pool.query(
    `select id, name, icon, invite_token_expires_at
     from "Group"
     where invite_token = $1 and deleted_at is null`,
    [token]
  );

  if (rows.length === 0) {
    res.status(404).json({ error: "Invite link not found" });
    return;
  }

  const group = rows[0];

  if (group.invite_token_expires_at && new Date(group.invite_token_expires_at) < new Date()) {
    res.status(410).json({ error: "Invite link has expired" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const me = await client.query('select name from "User" where id = $1', [userId]);
    const myName: string = me.rows[0]?.name || "Member";

    const existing = await client.query(
      'select 1 from "GroupMember" where group_id = $1 and user_id = $2',
      [group.id, userId]
    );

    // Already a member: idempotent; allow setting a nickname on re-visit.
    if (existing.rows.length > 0) {
      if (nickname) {
        if (await isDisplayNameTaken(client, group.id, nickname, userId)) {
          await client.query("ROLLBACK");
          res.status(409).json({ error: `"${nickname}" is already used in this group`, code: "NICKNAME_TAKEN" });
          return;
        }
        await client.query(
          'update "GroupMember" set nickname = $3 where group_id = $1 and user_id = $2',
          [group.id, userId, nickname]
        );
      }
      await client.query("COMMIT");
      res.json({ message: "Already a member", groupId: group.id, groupName: group.name, groupIcon: group.icon });
      return;
    }

    if (claimMemberId) {
      // Claim a placeholder: take over the history recorded for them.
      const ph = await client.query(
        `select gm.nickname, u.name
         from "GroupMember" gm join "User" u on u.id = gm.user_id
         where gm.group_id = $1 and gm.user_id = $2 and u.is_placeholder = true
         for update of gm`,
        [group.id, claimMemberId]
      );
      if (ph.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "That person was already claimed or doesn't exist", code: "PLACEHOLDER_GONE" });
        return;
      }

      const finalNickname: string = nickname || ph.rows[0].nickname || ph.rows[0].name;
      await transferUserReferences(client, claimMemberId, userId);
      // Remove the placeholder first so its nickname is free to reuse.
      await client.query(
        'delete from "GroupMember" where group_id = $1 and user_id = $2',
        [group.id, claimMemberId]
      );
      await client.query('update "User" set deleted_at = now() where id = $1', [claimMemberId]);
      if (await isDisplayNameTaken(client, group.id, finalNickname)) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: `"${finalNickname}" is already used in this group`, code: "NICKNAME_TAKEN" });
        return;
      }
      await client.query(
        `insert into "GroupMember" (group_id, user_id, role, nickname)
         values ($1, $2, 'member', $3)`,
        [group.id, userId, finalNickname]
      );
    } else {
      // Fresh join: a nickname is needed only if the name would be ambiguous.
      const effective = nickname || myName;
      if (await isDisplayNameTaken(client, group.id, effective)) {
        const suggestion = await suggestNickname(client, group.id, effective);
        await client.query("ROLLBACK");
        res.status(409).json({
          error: nickname
            ? `"${nickname}" is already used in this group`
            : `Someone named "${myName}" is already in this group, please pick a nickname`,
          code: nickname ? "NICKNAME_TAKEN" : "NICKNAME_REQUIRED",
          suggestion,
        });
        return;
      }
      await client.query(
        `insert into "GroupMember" (group_id, user_id, role, nickname)
         values ($1, $2, 'member', $3)`,
        [group.id, userId, nickname]
      );
    }

    await client.query("COMMIT");
    invalidateGroupBalanceCache(group.id).catch(() => {});

    res.json({
      message: "Joined successfully",
      groupId: group.id,
      groupName: group.name,
      groupIcon: group.icon,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /groups/join error:", err);
    res.status(500).json({ error: "Failed to join group" });
  } finally {
    client.release();
  }
});

/** Group + members for the group page. Caller must already have verified membership. */
export async function getGroupDetail(id: string, myRole: string) {
  // Fetch the group
  const groupResult = await pool.query(
    'select id, name, icon, invite_token, created_by, created_at from "Group" where id = $1 and deleted_at is null',
    [id]
  );

  if (groupResult.rows.length === 0) {
    return null;
  }

  const group = groupResult.rows[0];

  // Fetch members
  const membersResult = await pool.query(
    `select u.id, u.name, u.username, u.avatar_url, u.is_placeholder, gm.nickname, gm.role, gm.joined_at, gm.avatar_key
     from "GroupMember" gm
     join "User" u on u.id = gm.user_id
     where gm.group_id = $1
     order by gm.joined_at asc`,
    [id]
  );

  return {
    id: group.id,
    name: group.name,
    icon: group.icon,
    inviteToken: group.invite_token,
    createdBy: group.created_by,
    createdAt: group.created_at,
    myRole: myRole,
    members: membersResult.rows.map((m) => ({
      id: m.id,
      name: m.nickname || m.name, // display name used everywhere in the UI
      realName: m.is_placeholder ? null : m.name,
      nickname: m.nickname,
      username: m.is_placeholder ? null : m.username,
      avatarUrl: m.avatar_url,
      avatarKey: m.avatar_key,
      role: m.role,
      isPlaceholder: m.is_placeholder,
      joinedAt: m.joined_at,
    })),
  };
}

// ─── GET /groups/:id ─────────────────────────────────────────────────────────
/**
 * Return a single group's details + members list for the group detail page.
 * Auth: required — user must be a member of the group.
 */
router.get("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.userId;

  // Verify the requesting user is a member
  const membership = await pool.query(
    'select role from "GroupMember" where group_id = $1 and user_id = $2',
    [id, userId]
  );

  if (membership.rows.length === 0) {
    res.status(403).json({ error: "You are not a member of this group" });
    return;
  }

  const detail = await getGroupDetail(id, membership.rows[0].role);
  if (!detail) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json(detail);
});

// ─── GET /groups/:id/overview ────────────────────────────────────────────────
/**
 * Everything the group page needs in ONE round trip: details + members,
 * expenses, settlements and balances. Replaces five separate requests, which
 * matters most on slow mobile networks.
 */
router.get("/:id/overview", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.userId;

  const role = await getMemberRole(id, userId);
  if (!role) {
    res.status(403).json({ error: "You are not a member of this group" });
    return;
  }

  const [group, expenses, settlements, balance] = await Promise.all([
    getGroupDetail(id, role),
    listGroupExpenses(id, userId),
    listGroupSettlements(id, userId),
    getGroupBalance(id, userId),
  ]);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json({ group, expenses, settlements, balance });
});

// ─── POST /groups/:id/members ────────────────────────────────────────────────
/**
 * Admin adds a person who hasn't joined yet (a placeholder).
 * They can be used as payer / participant straight away; when the real person
 * opens the invite link they can claim this name and inherit everything.
 *
 * Body: { nickname: string }
 */
router.post("/:id/members", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.userId;
  const nickname = normalizeNickname((req.body || {}).nickname);

  if ((await getMemberRole(id, userId)) !== "admin") {
    res.status(403).json({ error: "Only the group admin can add people" });
    return;
  }
  if (!nickname) {
    res.status(400).json({ error: "A name is required" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (await isDisplayNameTaken(client, id, nickname)) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: `"${nickname}" is already in this group`, code: "NICKNAME_TAKEN" });
      return;
    }

    const username = `ph_${crypto.randomBytes(6).toString("hex")}`;
    const user = await client.query(
      `insert into "User" (username, name, is_placeholder)
       values ($1, $2, true)
       returning id`,
      [username, nickname]
    );
    await client.query(
      `insert into "GroupMember" (group_id, user_id, role, nickname, added_by)
       values ($1, $2, 'member', $3, $4)`,
      [id, user.rows[0].id, nickname, userId]
    );
    await client.query("COMMIT");

    res.status(201).json({
      id: user.rows[0].id,
      name: nickname,
      nickname,
      isPlaceholder: true,
      role: "member",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /groups/:id/members error:", err);
    res.status(500).json({ error: "Failed to add person" });
  } finally {
    client.release();
  }
});

// ─── PATCH /groups/:id/members/:userId ───────────────────────────────────────
/**
 * Change a nickname. Members can rename themselves; the admin can rename
 * placeholders (people who haven't joined).
 * Body: { nickname: string | null }   (null clears it, falling back to real name)
 */
router.patch("/:id/members/:userId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id, userId: targetId } = req.params;
  const userId = req.user!.userId;
  const nickname = normalizeNickname((req.body || {}).nickname);

  const myRole = await getMemberRole(id, userId);
  if (!myRole) {
    res.status(403).json({ error: "You are not a member of this group" });
    return;
  }

  const target = await pool.query(
    `select u.is_placeholder, u.name
     from "GroupMember" gm join "User" u on u.id = gm.user_id
     where gm.group_id = $1 and gm.user_id = $2`,
    [id, targetId]
  );
  if (target.rows.length === 0) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const isSelf = targetId === userId;
  const adminOnPlaceholder = myRole === "admin" && target.rows[0].is_placeholder;
  if (!isSelf && !adminOnPlaceholder) {
    res.status(403).json({ error: "You can only change your own nickname" });
    return;
  }
  if (!nickname && target.rows[0].is_placeholder) {
    res.status(400).json({ error: "A name is required" });
    return;
  }

  const finalName: string = nickname || target.rows[0].name;
  if (await isDisplayNameTaken(pool, id, finalName, targetId)) {
    res.status(409).json({ error: `"${finalName}" is already used in this group`, code: "NICKNAME_TAKEN" });
    return;
  }

  await pool.query(
    'update "GroupMember" set nickname = $3 where group_id = $1 and user_id = $2',
    [id, targetId, nickname]
  );
  invalidateGroupBalanceCache(id).catch(() => {});

  res.json({ id: targetId, nickname, name: finalName });
});

// ─── PUT /groups/:id/members/:userId/avatar ──────────────────────────────────
/**
 * Pick an illustrated avatar for this group. One avatar per person per group, so nobody
 * looks like anyone else. You pick your own; anyone in the group may pick one for a
 * person who hasn't joined yet (they can change it after joining).
 * Body: { avatarKey: string | null }   (null → profile photo, or coloured initials)
 * 409 { code: "AVATAR_TAKEN", takenBy } when someone else in the group has it.
 */
router.put("/:id/members/:userId/avatar", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id, userId: targetId } = req.params;
  const userId = req.user!.userId;
  const raw = (req.body || {}).avatarKey;
  const avatarKey = raw === null || raw === "" ? null : raw;
  if (avatarKey !== null && !isAvatarKey(avatarKey)) {
    res.status(400).json({ error: "Unknown avatar" });
    return;
  }

  if (!(await getMemberRole(id, userId))) {
    res.status(403).json({ error: "You are not a member of this group" });
    return;
  }
  const target = await pool.query(
    `select u.is_placeholder from "GroupMember" gm join "User" u on u.id = gm.user_id
     where gm.group_id = $1 and gm.user_id = $2`,
    [id, targetId]
  );
  if (target.rows.length === 0) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  if (targetId !== userId && !target.rows[0].is_placeholder) {
    res.status(403).json({ error: "People who have joined pick their own avatar" });
    return;
  }

  if (avatarKey) {
    const taken = await pool.query(
      `select coalesce(gm.nickname, u.name) as name from "GroupMember" gm join "User" u on u.id = gm.user_id
       where gm.group_id = $1 and gm.avatar_key = $2 and gm.user_id <> $3`,
      [id, avatarKey, targetId]
    );
    if (taken.rows.length > 0) {
      res.status(409).json({ error: `${taken.rows[0].name} already has this avatar`, code: "AVATAR_TAKEN", takenBy: taken.rows[0].name });
      return;
    }
  }

  try {
    await pool.query('update "GroupMember" set avatar_key = $3 where group_id = $1 and user_id = $2', [id, targetId, avatarKey]);
  } catch (err) {
    // Two people picked the same avatar at the same moment: the unique index decides.
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Someone just picked this avatar", code: "AVATAR_TAKEN" });
      return;
    }
    throw err;
  }
  invalidateGroupBalanceCache(id).catch(() => {});
  res.json({ id: targetId, avatarKey });
});

// ─── DELETE /groups/:id/members/:userId ──────────────────────────────────────
/**
 * Admin removes a placeholder who has no expenses or settlements yet
 * (e.g. added by mistake). People with history can't be removed, since that
 * would corrupt the balances.
 */
router.delete("/:id/members/:userId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id, userId: targetId } = req.params;
  const userId = req.user!.userId;

  if ((await getMemberRole(id, userId)) !== "admin") {
    res.status(403).json({ error: "Only the group admin can remove people" });
    return;
  }

  const target = await pool.query(
    `select u.is_placeholder
     from "GroupMember" gm join "User" u on u.id = gm.user_id
     where gm.group_id = $1 and gm.user_id = $2`,
    [id, targetId]
  );
  if (target.rows.length === 0) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  if (!target.rows[0].is_placeholder) {
    res.status(403).json({ error: "Only people who haven't joined can be removed" });
    return;
  }
  if (await userHasHistory(pool, targetId)) {
    res.status(409).json({ error: "This person already has expenses. Delete those first." });
    return;
  }

  await pool.query('delete from "GroupMember" where group_id = $1 and user_id = $2', [id, targetId]);
  await pool.query('update "User" set deleted_at = now() where id = $1', [targetId]);
  res.json({ message: "Removed", id: targetId });
});

export default router;
