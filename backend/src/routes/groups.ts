import { Router, Request, Response } from "express";
import crypto from "crypto";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { isAvatarKey } from "../lib/avatars";
import { invalidateGroupBalanceCache, getGroupBalance } from "./balance";
import { listGroupExpenses } from "./expenses";
import { listGroupSettlements } from "./settlements";
import { sendToUsers } from "../push";
import { claimPlaceholder, undoClaim, logActivity, logActivitySafe, displayName, SELF_UNDO_MS, type ClaimRow } from "../lib/groupSafety";
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

  // A personal invite (?as=<share token>) names who it was sent to, so they just confirm.
  const as = typeof req.query.as === "string" ? req.query.as : null;
  let invitedAs: { id: string; nickname: string } | null = null;
  if (as) {
    const ph = await pool.query(
      `select gm.user_id as id, coalesce(gm.nickname, u.name) as nickname
       from "GroupMember" gm join "User" u on u.id = gm.user_id
       where gm.group_id = $1 and gm.share_token = $2 and u.is_placeholder = true`,
      [group.id, as]
    );
    invitedAs = ph.rows[0] ?? null;
  }

  res.json({
    name: group.name,
    icon: group.icon,
    memberCount: group.member_count,
    unclaimedMembers: unclaimed.rows,
    invitedAs,
    /** the personal link was for someone who has already joined */
    personalInviteUsed: !!as && !invitedAs,
  });
});

// ─── POST /groups/preview/:token/not-me ──────────────────────────────────────
/**
 * Someone opened a personal invite that isn't for them ("I'm not Ankit"). The admins
 * are told, so a wrong number or a forwarded link gets noticed. Body: { as }.
 */
router.post("/preview/:token/not-me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;
  const as = typeof req.body?.as === "string" ? req.body.as : null;
  const g = await pool.query('select id, name from "Group" where invite_token = $1 and deleted_at is null', [token]);
  if (g.rows.length === 0 || !as) { res.status(404).json({ error: "Invite link not found" }); return; }
  const group = g.rows[0];
  const ph = await pool.query(
    `select coalesce(gm.nickname, u.name) as nickname from "GroupMember" gm join "User" u on u.id = gm.user_id
     where gm.group_id = $1 and gm.share_token = $2`,
    [group.id, as]
  );
  const who = await pool.query('select name from "User" where id = $1', [req.user!.userId]);
  const placeholderName = ph.rows[0]?.nickname ?? "someone";
  const accountName = who.rows[0]?.name ?? "Someone";
  const admins = await pool.query(`select user_id from "GroupMember" where group_id = $1 and role = 'admin'`, [group.id]);
  await sendToUsers(admins.rows.map((r: { user_id: string }) => r.user_id), {
    title: group.name,
    body: `${accountName} opened ${placeholderName}'s invite and says it isn't them. Check who you sent it to.`,
    url: `/groups/${group.id}`,
  }).catch(() => {});
  await logActivitySafe(pool, { groupId: group.id, actorId: req.user!.userId, kind: "invite_disputed", summary: { accountName, placeholderName } });
  res.json({ message: "The admin has been told" });
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
    let joinedAs: string | null = null;

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
      // Claim a placeholder: take over the history recorded for them (undoable, see MemberClaim).
      const claimed = await claimPlaceholder(client, group.id, claimMemberId, userId, nickname);
      if (!claimed.ok) {
        await client.query("ROLLBACK");
        if (claimed.code === "PLACEHOLDER_GONE") res.status(404).json({ error: "That person was already claimed or doesn't exist", code: "PLACEHOLDER_GONE" });
        else res.status(409).json({ error: `"${claimed.name}" is already used in this group`, code: "NICKNAME_TAKEN" });
        return;
      }
      await logActivity(client, {
        groupId: group.id, actorId: userId, kind: "member_claimed", targetUser: userId,
        summary: { accountName: myName, placeholderName: claimed.placeholderName, claimId: claimed.claimId },
      });
      joinedAs = claimed.placeholderName;
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
      await logActivity(client, { groupId: group.id, actorId: userId, kind: "member_joined", targetUser: userId, summary: { name: nickname || myName } });
    }

    await client.query("COMMIT");
    invalidateGroupBalanceCache(group.id).catch(() => {});

    // Tell the admins (and whoever the claimed name owes / is owed by) so a wrong pick is noticed.
    if (joinedAs) {
      const watchers = await pool.query(
        `select user_id from "GroupMember" gm join "User" u on u.id = gm.user_id
         where gm.group_id = $1 and u.is_placeholder = false and gm.user_id <> $2`,
        [group.id, userId]
      );
      await sendToUsers(watchers.rows.map((r: { user_id: string }) => r.user_id), {
        title: group.name,
        body: `${myName} joined as ${joinedAs}. Not right? Open the group to fix it.`,
        url: `/groups/${group.id}`,
      }).catch(() => {});
    }

    res.json({
      message: "Joined successfully",
      joinedAs,
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

  // Active claims: lets the claimer say "Not me" and the admin undo or reassign.
  const claims = await pool.query(
    `select id, claimed_by, placeholder_nickname, created_at from "MemberClaim"
     where group_id = $1 and undone_at is null`,
    [id]
  );
  const claimOf = new Map<string, { claimId: string; placeholderName: string | null; claimedAt: string }>();
  for (const c of claims.rows) claimOf.set(c.claimed_by, { claimId: c.id, placeholderName: c.placeholder_nickname, claimedAt: c.created_at });

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
      /** set when this person joined by picking a placeholder's name */
      claim: claimOf.get(m.id) ?? null,
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
    await logActivity(client, { groupId: id, actorId: userId, kind: "member_added", targetUser: user.rows[0].id, summary: { name: nickname } });
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
  if (targetId === userId) {
    res.status(400).json({ error: "Use Leave group to leave" });
    return;
  }
  const isPh = target.rows[0].is_placeholder;
  const hasHistory = await userHasHistory(pool, targetId);
  if (hasHistory && !(await isSettled(id, targetId))) {
    res.status(409).json({ error: "They still owe or are owed money here. Settle up first, then remove them.", code: "NOT_SETTLED" });
    return;
  }
  const name = await displayName(pool, id, targetId);
  await pool.query('delete from "GroupMember" where group_id = $1 and user_id = $2', [id, targetId]);
  // A placeholder with no history is just a typo: drop it entirely.
  if (isPh && !hasHistory) await pool.query('update "User" set deleted_at = now() where id = $1', [targetId]);
  await invalidateGroupBalanceCache(id).catch(() => {});
  await logActivitySafe(pool, { groupId: id, actorId: userId, kind: "member_removed", targetUser: targetId, summary: { name } });
  res.json({ message: "Removed", id: targetId });
});

/** True when the person's balance in the group is zero (fresh numbers, not the cache). */
async function isSettled(groupId: string, userId: string): Promise<boolean> {
  await invalidateGroupBalanceCache(groupId).catch(() => {});
  const bal = await getGroupBalance(groupId, userId);
  const me = bal?.memberBalances.find((m) => m.userId === userId);
  return !me || Math.abs(parseFloat(me.signedAmount)) < 0.005;
}

// ─── POST /groups/:id/leave ──────────────────────────────────────────────────
/**
 * Leave a group once you're settled up. Your past expenses stay (they still add up for
 * everyone else). If you were the only admin, the longest-standing member takes over.
 */
router.post("/:id/leave", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.userId;
  const role = await getMemberRole(id, userId);
  if (!role) { res.status(404).json({ error: "You're not in this group" }); return; }
  if (!(await isSettled(id, userId))) {
    res.status(409).json({ error: "You still owe or are owed money here. Settle up first, then leave.", code: "NOT_SETTLED" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const name = await displayName(client, id, userId);
    await client.query('delete from "GroupMember" where group_id = $1 and user_id = $2', [id, userId]);
    if (role === "admin") {
      const admins = await client.query(`select 1 from "GroupMember" where group_id = $1 and role = 'admin' limit 1`, [id]);
      if (admins.rows.length === 0) {
        await client.query(
          `update "GroupMember" set role = 'admin'
           where group_id = $1 and user_id = (
             select gm.user_id from "GroupMember" gm join "User" u on u.id = gm.user_id
             where gm.group_id = $1 and u.is_placeholder = false order by gm.joined_at asc limit 1)`,
          [id]
        );
      }
    }
    await logActivity(client, { groupId: id, actorId: userId, kind: "member_left", targetUser: userId, summary: { name } });
    await client.query("COMMIT");
    await invalidateGroupBalanceCache(id).catch(() => {});
    res.json({ message: "Left the group" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// ─── POST /groups/:id/claims/:claimId/undo ───────────────────────────────────
/**
 * "That's not me": put a claim back. The placeholder returns with its history; the
 * person stays in the group with nothing. Optional { claimMemberId } re-claims the right
 * placeholder in the same step (reassign).
 * Who: the person who claimed (within 7 days) or a group admin (any time).
 */
router.post("/:id/claims/:claimId/undo", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id, claimId } = req.params;
  const userId = req.user!.userId;
  const { claimMemberId } = (req.body || {}) as { claimMemberId?: string };
  const role = await getMemberRole(id, userId);
  if (!role) { res.status(403).json({ error: "You're not in this group" }); return; }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      'select * from "MemberClaim" where id = $1 and group_id = $2 and undone_at is null for update',
      [claimId, id]
    );
    const claim = found.rows[0] as ClaimRow | undefined;
    if (!claim) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Nothing to undo. It may have been undone already." });
      return;
    }
    const isClaimer = claim.claimed_by === userId;
    const inWindow = Date.now() - new Date(claim.created_at).getTime() < SELF_UNDO_MS;
    if (!(role === "admin" || (isClaimer && inWindow))) {
      await client.query("ROLLBACK");
      res.status(403).json({ error: isClaimer ? "It's been more than 7 days. Ask the group admin to fix it." : "Only the group admin can do this" });
      return;
    }

    const undone = await undoClaim(client, claim, userId);
    await logActivity(client, {
      groupId: id, actorId: userId, kind: "claim_undone", targetUser: claim.claimed_by,
      summary: { placeholderName: undone.placeholderName, claimerName: undone.claimerName },
    });

    let reclaimed: string | null = null;
    if (claimMemberId) {
      if (claimMemberId === claim.placeholder_id) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "Pick a different name" });
        return;
      }
      const again = await claimPlaceholder(client, id, claimMemberId, claim.claimed_by, null);
      if (!again.ok) {
        await client.query("ROLLBACK");
        res.status(again.code === "PLACEHOLDER_GONE" ? 404 : 409).json({ error: again.code === "PLACEHOLDER_GONE" ? "That person was already claimed" : `"${again.name}" is already used in this group`, code: again.code });
        return;
      }
      reclaimed = again.placeholderName;
      await logActivity(client, {
        groupId: id, actorId: userId, kind: "member_claimed", targetUser: claim.claimed_by,
        summary: { accountName: undone.claimerName, placeholderName: again.placeholderName, claimId: again.claimId, reassigned: true },
      });
    }

    await client.query("COMMIT");
    await invalidateGroupBalanceCache(id).catch(() => {});
    if (!isClaimer) {
      await sendToUsers([claim.claimed_by], {
        title: "Your name in the group was fixed",
        body: reclaimed ? `You're now ${reclaimed} (not ${undone.placeholderName}).` : `You're no longer ${undone.placeholderName}. Pick your own name if you're on the list.`,
        url: `/groups/${id}`,
      }).catch(() => {});
    }
    res.json({ message: "Undone", placeholderName: undone.placeholderName, reclaimed });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// ─── GET /groups/:id/activity ────────────────────────────────────────────────
/** Newest first, 40 at a time. ?before=<id> pages back. */
router.get("/:id/activity", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.userId;
  if (!(await getMemberRole(id, userId))) { res.status(403).json({ error: "You're not in this group" }); return; }
  const before = Number(req.query.before);
  const rows = await pool.query(
    `select a.id, a.kind, a.actor_id, a.expense_id, a.settlement_id, a.target_user, a.summary, a.created_at,
            coalesce(gm.nickname, u.name) as actor_name,
            (e.deleted_at is not null) as expense_deleted
     from "GroupActivity" a
     left join "User" u on u.id = a.actor_id
     left join "GroupMember" gm on gm.group_id = a.group_id and gm.user_id = a.actor_id
     left join "Expense" e on e.id = a.expense_id
     where a.group_id = $1 and ($2::bigint is null or a.id < $2)
     order by a.id desc limit 40`,
    [id, Number.isFinite(before) && before > 0 ? before : null]
  );
  res.json({
    items: rows.rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      actor: r.actor_id ? { id: r.actor_id, name: r.actor_name ?? "Someone" } : null,
      expenseId: r.expense_id,
      expenseDeleted: r.expense_deleted === true,
      settlementId: r.settlement_id,
      targetUser: r.target_user,
      summary: r.summary,
      createdAt: r.created_at,
    })),
    nextBefore: rows.rows.length === 40 ? Number(rows.rows[rows.rows.length - 1].id) : null,
  });
});

// ─── GET /groups/preview/:token/claim/:memberId ──────────────────────────────
/** Before claiming a name: what you'd take over (signed-in joiners only). */
router.get("/preview/:token/claim/:memberId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { token, memberId } = req.params;
  const g = await pool.query('select id from "Group" where invite_token = $1 and deleted_at is null', [token]);
  if (g.rows.length === 0) { res.status(404).json({ error: "Invite link not found" }); return; }
  const groupId = g.rows[0].id;
  const ph = await pool.query(
    `select 1 from "GroupMember" gm join "User" u on u.id = gm.user_id
     where gm.group_id = $1 and gm.user_id = $2 and u.is_placeholder = true`,
    [groupId, memberId]
  );
  if (ph.rows.length === 0) { res.status(404).json({ error: "That person was already claimed" }); return; }
  const count = await pool.query(
    `select count(distinct e.id)::int as n from "Expense" e
     left join "ExpensePayer" ep on ep.expense_id = e.id and ep.user_id = $2
     left join "ExpenseSplit" es on es.expense_id = e.id and es.user_id = $2
     where e.group_id = $1 and e.deleted_at is null and (ep.user_id is not null or es.user_id is not null)`,
    [groupId, memberId]
  );
  const bal = await getGroupBalance(groupId, memberId);
  const mine = bal?.memberBalances.find((m) => m.userId === memberId);
  res.json({ expenseCount: count.rows[0]?.n ?? 0, signedAmount: mine?.signedAmount ?? "0.00" });
});

export default router;
