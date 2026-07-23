/**
 * push.ts — Web Push notification helper (Stage 7)
 *
 * Wraps `web-push` with:
 *   - VAPID config loaded once from env
 *   - sendToUser(userId, payload): sends to ALL subscriptions for that user,
 *     silently removes subscriptions that 410/404 (gone/invalid)
 *   - sendToUsers(userIds[], payload): fan-out helper
 *
 * Architecture constraint: push is best-effort — if the push service is
 * unavailable or the subscription has expired, we log a warning and move on.
 * Push failures MUST NOT cause the originating HTTP request to fail.
 */

import webpush from "web-push";
import pool from "./db/pool";

// ── VAPID configuration (initialised once on import) ──────────────────────────
const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_MAILTO } = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn(
    "[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications disabled"
  );
} else {
  webpush.setVapidDetails(
    VAPID_MAILTO || "mailto:spenit@example.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

export const vapidPublicKey = VAPID_PUBLIC_KEY || "";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PushPayload {
  title: string;
  body: string;
  /** Client-side route to open when notification is tapped */
  url?: string;
  /** Icon shown in the notification — served from /public */
  icon?: string;
  tag?: string; // de-duplicates notifications of the same category
}

// ── Core send helper ───────────────────────────────────────────────────────────

/**
 * Send a push notification to every subscription registered for `userId`.
 * Stale (410/404) subscriptions are automatically purged from the DB.
 * This function NEVER throws — all errors are caught and logged.
 */
export async function sendToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!VAPID_PUBLIC_KEY) return; // Push disabled

  let subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[];
  try {
    const result = await pool.query(
      'SELECT id, endpoint, p256dh, auth FROM "PushSubscription" WHERE user_id = $1',
      [userId]
    );
    subscriptions = result.rows;
  } catch (err) {
    console.error("[push] DB lookup failed:", err);
    return;
  }

  if (subscriptions.length === 0) return;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/dashboard",
    icon: payload.icon || "/icon-192.png",
    tag: payload.tag,
  });

  const staleIds: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 * 24 } // 24h TTL — deliver even if device is offline
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 410 || status === 404) {
          // Subscription is gone — schedule for removal
          staleIds.push(sub.id);
        } else {
          console.warn(`[push] sendNotification failed for sub ${sub.id}:`, (err as Error).message);
        }
      }
    })
  );

  // Purge stale subscriptions asynchronously
  if (staleIds.length > 0) {
    pool.query('DELETE FROM "PushSubscription" WHERE id = ANY($1)', [staleIds]).catch((err) =>
      console.error("[push] Failed to purge stale subscriptions:", err)
    );
  }
}

/**
 * Fan-out push to multiple users.
 * Filters out the excluded userId (e.g., the actor who triggered the event).
 */
export async function sendToUsers(
  userIds: string[],
  payload: PushPayload,
  excludeUserId?: string
): Promise<void> {
  const targets = excludeUserId ? userIds.filter((id) => id !== excludeUserId) : userIds;
  if (targets.length === 0) return;
  await Promise.allSettled(targets.map((uid) => sendToUser(uid, payload)));
}
