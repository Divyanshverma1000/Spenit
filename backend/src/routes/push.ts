/**
 * push.ts route — Web Push subscription management (Stage 7)
 *
 * Endpoints:
 *   GET    /push/vapid-key         — return public VAPID key (unauthenticated)
 *   POST   /push/subscribe         — save/update a push subscription for the authed user
 *   DELETE /push/subscribe         — remove a push subscription (logout / revoke)
 *   POST   /push/test              — send a test notification to the authed user (dev only)
 */

import { Router, Request, Response } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { vapidPublicKey, sendToUser } from "../push";

const router = Router();

// ─── GET /push/vapid-key ──────────────────────────────────────────────────────
/**
 * Returns the VAPID public key so the frontend can subscribe.
 * Not authenticated — the browser needs this before the user has a token.
 */
router.get("/vapid-key", (_req: Request, res: Response): void => {
  if (!vapidPublicKey) {
    res.status(503).json({ error: "Push notifications are not configured on this server" });
    return;
  }
  res.json({ publicKey: vapidPublicKey });
});

// ─── POST /push/subscribe ─────────────────────────────────────────────────────
/**
 * Save a Web Push subscription for the authenticated user.
 * Body: { endpoint, expirationTime, keys: { p256dh, auth }, userAgent? }
 *
 * Uses UPSERT so re-subscribing with the same endpoint is idempotent.
 */
router.post("/subscribe", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { endpoint, keys, expirationTime, userAgent } = req.body;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    res.status(400).json({ error: "endpoint and keys (p256dh, auth) are required" });
    return;
  }

  await pool.query(
    `INSERT INTO "PushSubscription" (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           p256dh  = EXCLUDED.p256dh,
           auth    = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           updated_at = now()`,
    [userId, endpoint, keys.p256dh, keys.auth, userAgent || req.headers["user-agent"] || null]
  );

  res.status(201).json({ message: "Subscribed" });
});

// ─── DELETE /push/subscribe ───────────────────────────────────────────────────
/**
 * Remove a push subscription (user unsubscribed or logged out).
 * Body: { endpoint }
 */
router.delete("/subscribe", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { endpoint } = req.body;

  if (!endpoint) {
    res.status(400).json({ error: "endpoint is required" });
    return;
  }

  await pool.query(
    'DELETE FROM "PushSubscription" WHERE user_id = $1 AND endpoint = $2',
    [userId, endpoint]
  );

  res.json({ message: "Unsubscribed" });
});

// ─── POST /push/test (dev only) ───────────────────────────────────────────────
/**
 * Send a test notification to the authenticated user.
 * Use this to verify the full push pipeline without creating real expenses.
 */
router.post("/test", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  await sendToUser(userId, {
    title: "🎉 Push is working!",
    body: "Spenit notifications are set up correctly on your device.",
    url: "/dashboard",
    tag: "test",
  });
  res.json({ message: "Test notification sent (if subscribed)" });
});

export default router;
