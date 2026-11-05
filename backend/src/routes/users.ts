import { Router, Request, Response } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { MAX_PHOTO_BASE64, PHOTO_MIME } from "../lib/avatars";

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

// ─── Profile photo ────────────────────────────────────────────────────────────
/**
 * PUT /users/me/photo  { imageBase64 }  — a small photo (the phone resizes it to 256px).
 * "User".avatar_url becomes "/users/<id>/photo?v=<time>", which the frontend serves through
 * its /api proxy. The ?v= changes on every upload, so the long cache below is safe.
 */
router.put("/me/photo", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const imageBase64 = (req.body || {}).imageBase64;
  if (typeof imageBase64 !== "string" || imageBase64.length > MAX_PHOTO_BASE64) {
    res.status(400).json({ error: "Photo must be an image under 300 KB" });
    return;
  }
  const match = PHOTO_MIME.exec(imageBase64);
  if (!match) {
    res.status(400).json({ error: "Photo must be a JPEG, PNG or WebP image" });
    return;
  }
  await pool.query(
    `INSERT INTO "UserPhoto" (user_id, mime, data, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = now()`,
    [userId, match[1], match[2]]
  );
  const avatarUrl = `/users/${userId}/photo?v=${Date.now()}`;
  await pool.query('UPDATE "User" SET avatar_url = $2, updated_at = now() WHERE id = $1', [userId, avatarUrl]);
  res.json({ avatarUrl });
});

/** DELETE /users/me/photo — back to the group avatar / coloured initials. */
router.delete("/me/photo", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  await pool.query('DELETE FROM "UserPhoto" WHERE user_id = $1', [userId]);
  await pool.query('UPDATE "User" SET avatar_url = NULL, updated_at = now() WHERE id = $1', [userId]);
  res.json({ avatarUrl: null });
});

/**
 * GET /users/:id/photo — public (an <img> can't send a token), like Google profile photo
 * URLs. Only reachable with the user's random id.
 */
router.get("/:id/photo", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(404).end();
    return;
  }
  const { rows } = await pool.query('SELECT mime, data FROM "UserPhoto" WHERE user_id = $1', [id]);
  if (rows.length === 0) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", rows[0].mime);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(Buffer.from(rows[0].data, "base64"));
});


export default router;
