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

// ── VAPID configuration ───────────────────────────────────────────────────────
// Read lazily (not at import time): on Cloudflare Workers the environment is only
// guaranteed to be available once a request is being handled.
let vapidReady: boolean | null = null;

function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_MAILTO } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications disabled");
    vapidReady = false;
  } else {
    webpush.setVapidDetails(VAPID_MAILTO || "mailto:spenit@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
  }
  return vapidReady;
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || "";
}

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
export interface SendResult { devices: number; delivered: number; failed: number; removed: number; errors: string[] }

/** Write down what happened, so "was that notification ever sent?" has an answer. */
async function logSend(userId: string, payload: PushPayload, r: SendResult): Promise<void> {
  try {
    await pool.query(
      `insert into "NotificationLog" (user_id, title, tag, devices, delivered, failed, removed, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, payload.title.slice(0, 120), payload.tag ?? null, r.devices, r.delivered, r.failed, r.removed, r.errors.join("; ").slice(0, 300) || null]
    );
  } catch {
    // the log is best effort
  }
}

export async function sendToUser(userId: string, payload: PushPayload): Promise<SendResult> {
  const result: SendResult = { devices: 0, delivered: 0, failed: 0, removed: 0, errors: [] };
  if (!ensureVapid()) {
    result.errors.push("Push isn't set up on the server (VAPID keys missing)");
    await logSend(userId, payload, result);
    return result;
  }

  let subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[];
  try {
    const result = await pool.query(
      'SELECT id, endpoint, p256dh, auth FROM "PushSubscription" WHERE user_id = $1',
      [userId]
    );
    subscriptions = result.rows;
  } catch (err) {
    console.error("[push] DB lookup failed:", err);
    result.errors.push("Couldn't read this person's devices");
    await logSend(userId, payload, result);
    return result;
  }

  result.devices = subscriptions.length;
  if (subscriptions.length === 0) {
    result.errors.push("Notifications aren't switched on in Spenit on any device for this account");
    await logSend(userId, payload, result);
    return result;
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/dashboard",
    icon: payload.icon || "/Spenit-icon-192.png",
    tag: payload.tag,
  });

  const staleIds: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        // web-push builds the encrypted, VAPID-signed request; we send it with fetch so the same
        // code works on Node and on Cloudflare Workers (web-push's own sender needs Node's https).
        const req = webpush.generateRequestDetails(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 60 * 60 * 24 } // 24h TTL — deliver even if device is offline
        );
        const { "Content-Length": _len, ...headers } = (req.headers ?? {}) as Record<string, string>;
        const res = await fetch(req.endpoint, {
          method: req.method,
          headers,
          body: req.body as unknown as Buffer,
          signal: AbortSignal.timeout(8000),
        });
        if (res.status === 410 || res.status === 404) {
          // Subscription is gone — schedule for removal
          staleIds.push(sub.id);
          result.removed++;
        } else if (!res.ok) {
          result.failed++;
          result.errors.push(`push service answered ${res.status}`);
          console.warn(`[push] push service answered ${res.status} for sub ${sub.id}`);
        } else {
          result.delivered++;
        }
      } catch (err: unknown) {
        result.failed++;
        result.errors.push((err as Error).message.slice(0, 80));
        console.warn(`[push] sending failed for sub ${sub.id}:`, (err as Error).message);
      }
    })
  );

  // Purge stale subscriptions (awaited: on Workers, work left running after the reply is cut off)
  if (staleIds.length > 0) {
    await pool.query('DELETE FROM "PushSubscription" WHERE id = ANY($1)', [staleIds]).catch((err) =>
      console.error("[push] Failed to purge stale subscriptions:", err)
    );
  }
  await logSend(userId, payload, result);
  return result;
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
