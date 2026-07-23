import { Router, Request, Response } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";

const router = Router();

/**
 * GET /users/me
 *
 * Protected endpoint — requires a valid JWT access token in the Authorization header.
 * Returns the signed-in user's profile row from Postgres.
 *
 * This endpoint is the Stage 1 proof that JWT auth actually protects a route:
 *   - No token → 401 (from requireAuth middleware)
 *   - Invalid token → 401 (from requireAuth middleware)
 *   - Valid token → 200 with user object
 */
router.get("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { rows } = await pool.query(
    `select id, username, name, email, avatar_url, upi_id, created_at, groq_api_key
     from "User"
     where id = $1 and deleted_at is null`,
    [req.user!.userId]
  );

  if (rows.length === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const u = rows[0];
  let groqKeyMasked = null;
  if (u.groq_api_key) {
    const key = u.groq_api_key as string;
    groqKeyMasked = key.startsWith("gsk_") && key.length > 8 
      ? `gsk_***${key.slice(-4)}` 
      : "***";
  }

  res.json({
    id: u.id,
    username: u.username,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatar_url,
    upiId: u.upi_id,
    createdAt: u.created_at,
    hasGroqKey: !!u.groq_api_key,
    groqKeyMasked,
  });
});

/**
 * PATCH /users/me
 * Update the authenticated user's profile (upi_id, username).
 */
router.patch("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { upiId, username, groqApiKey } = req.body;

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (upiId !== undefined) {
    updates.push(`upi_id = $${idx++}`);
    values.push(upiId || null);
  }
  if (groqApiKey !== undefined) {
    updates.push(`groq_api_key = $${idx++}`);
    values.push(groqApiKey.trim() || null);
  }
  if (username !== undefined && username.trim()) {
    // Check uniqueness
    const existing = await pool.query(
      'SELECT id FROM "User" WHERE username = $1 AND id != $2',
      [username.trim(), userId]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    updates.push(`username = $${idx++}`);
    values.push(username.trim().toLowerCase());
  }

  if (updates.length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  values.push(userId);
  const { rows } = await pool.query(
    `UPDATE "User" SET ${updates.join(", ")} WHERE id = $${idx} RETURNING id`,
    values
  );

  res.json({ success: true, updatedFields: updates.length });
});

export default router;
