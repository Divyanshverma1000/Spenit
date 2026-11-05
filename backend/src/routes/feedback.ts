/**
 * "Report a problem / share an idea" (Profile). The admins get a push notification and
 * see it on /admin, with the screen it came from, the app version and a short device
 * description, so they can follow up. People are told it's read by the team.
 *
 *   POST  /feedback                { kind, message, page?, appVersion? }
 *   PATCH /feedback/:id            { status: "new" | "done" }   (admins)
 */
import { Router, Request, Response } from "express";
import pool from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { sendToUsers } from "../push";
import { adminEmails } from "../lib/telemetry";
import { scrub } from "../lib/safeLog";

const router = Router();
const KINDS = ["problem", "idea", "other", "test"];

/** A short, non-identifying device line from the user agent ("Android · Chrome"). */
function device(ua: string | undefined): string {
  if (!ua) return "unknown";
  const os = /android/i.test(ua) ? "Android" : /iphone|ipad|ios/i.test(ua) ? "iOS" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : /linux/i.test(ua) ? "Linux" : "other";
  const browser = /edg\//i.test(ua) ? "Edge" : /samsungbrowser/i.test(ua) ? "Samsung Internet" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "other";
  const pwa = /wv\)|standalone/i.test(ua) ? " · app" : "";
  return `${os} · ${browser}${pwa}`;
}

export async function isAdmin(userId: string): Promise<boolean> {
  const admins = adminEmails();
  if (!admins.length) return false;
  const r = await pool.query('select lower(email) as email from "User" where id = $1 and deleted_at is null', [userId]);
  return !!r.rows[0]?.email && admins.includes(r.rows[0].email);
}

router.post("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { kind, message, page, appVersion } = (req.body ?? {}) as Record<string, unknown>;
  const text = typeof message === "string" ? message.trim() : "";
  if (text.length < 3) { res.status(400).json({ error: "Tell us a little more" }); return; }
  if (text.length > 2000) { res.status(400).json({ error: "Keep it under 2,000 characters" }); return; }
  const k = KINDS.includes(String(kind)) ? String(kind) : "other";
  const r = await pool.query(
    `insert into "Feedback" (user_id, kind, message, page, app_version, device)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      req.user!.userId, k, text,
      typeof page === "string" ? page.replace(/[0-9a-f-]{36}/gi, ":id").slice(0, 120) : null,
      typeof appVersion === "string" ? appVersion.slice(0, 40) : null,
      device(req.headers["user-agent"]),
    ]
  );
  // Tell the admins (not the message itself in full: it can be long or personal).
  const admins = adminEmails();
  if (admins.length) {
    const ids = await pool.query('select id from "User" where lower(email) = any($1::text[]) and deleted_at is null', [admins]);
    sendToUsers(ids.rows.map((a: { id: string }) => a.id), {
      title: k === "problem" ? "New problem report" : k === "idea" ? "New idea" : k === "test" ? "Test results in" : "New feedback",
      body: scrub(text).slice(0, 100),
      url: "/admin",
      tag: `feedback-${r.rows[0].id}`,
    }).catch(() => {});
  }
  res.status(201).json({ id: Number(r.rows[0].id) });
});

router.patch("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!(await isAdmin(req.user!.userId))) { res.status(403).json({ error: "Admins only" }); return; }
  const status = req.body?.status === "done" ? "done" : "new";
  await pool.query('update "Feedback" set status = $2 where id = $1', [Number(req.params.id), status]);
  res.json({ id: Number(req.params.id), status });
});

export default router;
