import { Router, Request, Response } from "express";
import crypto from "crypto";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";

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
  const { name, icon } = req.body as { name?: string; icon?: string };

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
      `insert into "GroupMember" (group_id, user_id, role)
       values ($1, $2, 'admin')`,
      [group.id, userId]
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
       (select count(*) from "GroupMember" gm2 where gm2.group_id = g.id)::int as member_count
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

  res.json({
    name: group.name,
    icon: group.icon,
    memberCount: group.member_count,
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

  // Look up the group by invite token
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

  // Upsert GroupMember — idempotent (already a member? return their existing row)
  await pool.query(
    `insert into "GroupMember" (group_id, user_id, role)
     values ($1, $2, 'member')
     on conflict (group_id, user_id) do nothing`,
    [group.id, userId]
  );

  res.json({
    message: "Joined successfully",
    groupId: group.id,
    groupName: group.name,
    groupIcon: group.icon,
  });
});

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

  // Fetch the group
  const groupResult = await pool.query(
    'select id, name, icon, invite_token, created_by, created_at from "Group" where id = $1 and deleted_at is null',
    [id]
  );

  if (groupResult.rows.length === 0) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const group = groupResult.rows[0];

  // Fetch members
  const membersResult = await pool.query(
    `select u.id, u.name, u.username, u.avatar_url, gm.role, gm.joined_at
     from "GroupMember" gm
     join "User" u on u.id = gm.user_id
     where gm.group_id = $1
     order by gm.joined_at asc`,
    [id]
  );

  res.json({
    id: group.id,
    name: group.name,
    icon: group.icon,
    inviteToken: group.invite_token,
    createdBy: group.created_by,
    createdAt: group.created_at,
    myRole: membership.rows[0].role,
    members: membersResult.rows.map((m) => ({
      id: m.id,
      name: m.name,
      username: m.username,
      avatarUrl: m.avatar_url,
      role: m.role,
      joinedAt: m.joined_at,
    })),
  });
});

export default router;
