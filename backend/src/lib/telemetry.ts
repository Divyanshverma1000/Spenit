/**
 * telemetry.ts — the numbers behind the admin dashboard, and error alerts.
 *
 * Everything stays in our own database (no third-party analytics) and holds no personal
 * content: who was active (ids only), daily counters, and error summaries that have been
 * scrubbed of emails, keys and tokens (lib/safeLog). Days are India time.
 *
 * Writes are cheap and rare: a person's activity is recorded at most once a minute per
 * server instance; failures never affect the request.
 */
import pool from "../db/pool";
import { scrub } from "./safeLog";
import { sendToUsers } from "../push";

const IST_DAY = `(now() at time zone 'Asia/Kolkata')::date`;

// ── Activity ──────────────────────────────────────────────────────────────────

const lastTouch = new Map<string, number>();
const TOUCH_EVERY_MS = 60_000;

/** Mark a signed-in person as active now (last seen + today's active list). */
export async function touchUser(userId: string): Promise<void> {
  const now = Date.now();
  if (now - (lastTouch.get(userId) ?? 0) < TOUCH_EVERY_MS) return;
  lastTouch.set(userId, now);
  if (lastTouch.size > 5000) lastTouch.clear();
  try {
    await pool.query(
      `with seen as (
         update "User" set last_seen_at = now()
         where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '1 minute')
         returning id
       )
       insert into "UserActiveDay" (user_id, day)
       select $1, ${IST_DAY} where exists (select 1 from "User" where id = $1)
       on conflict do nothing`,
      [userId]
    );
  } catch {
    // never block a request on bookkeeping
  }
}

// ── Counters ──────────────────────────────────────────────────────────────────

export type Metric =
  | "ai_calls" | "ai_failures" | "ai_tokens_in" | "ai_tokens_out"
  | "order_reads" | "chat_questions" | "receipt_scans";

/** Add to today's counters, e.g. bump({ ai_calls: 1, ai_tokens_in: 812 }). */
export async function bump(counts: Partial<Record<Metric, number>>): Promise<void> {
  const entries = Object.entries(counts).filter(([, n]) => typeof n === "number" && n > 0) as [Metric, number][];
  if (entries.length === 0) return;
  try {
    await pool.query(
      `insert into "UsageDaily" (day, metric, count)
       select ${IST_DAY}, m, n from unnest($1::text[], $2::bigint[]) as t(m, n)
       on conflict (day, metric) do update set count = "UsageDaily".count + excluded.count`,
      [entries.map((e) => e[0]), entries.map((e) => Math.round(e[1]))]
    );
  } catch {
    // counters are best effort
  }
}

// ── Errors ────────────────────────────────────────────────────────────────────

/** Same kind of error → same fingerprint: numbers and ids are blanked out first. */
export function fingerprint(source: string, message: string, path?: string | null): string {
  const norm = (s: string) =>
    s.toLowerCase()
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id")
      .replace(/\d+/g, "#")
      .slice(0, 200);
  const raw = `${source}|${norm(message)}|${norm(path ?? "")}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Admin emails (wrangler var ADMIN_EMAILS, comma-separated). */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/**
 * Record an error. The first time a kind of error is seen on a day, the admins get a
 * push notification, so problems are noticed before users report them.
 */
export async function recordError(source: "api" | "app", message: string, path?: string | null): Promise<void> {
  const msg = scrub(String(message || "Unknown error")).slice(0, 300);
  const p = path ? scrub(path.split("?")[0]).slice(0, 200) : null;
  const fp = fingerprint(source, msg, p);
  try {
    const r = await pool.query(
      `insert into "ErrorDaily" (day, fingerprint, source, message, path, count)
       values (${IST_DAY}, $1, $2, $3, $4, 1)
       on conflict (day, fingerprint) do update set count = "ErrorDaily".count + 1, last_at = now()
       returning count`,
      [fp, source, msg, p]
    );
    if (Number(r.rows[0]?.count) === 1) {
      const emails = adminEmails();
      if (emails.length) {
        const admins = await pool.query('select id from "User" where lower(email) = any($1::text[]) and deleted_at is null', [emails]);
        await sendToUsers(admins.rows.map((a: { id: string }) => a.id), {
          title: `New ${source === "api" ? "server" : "app"} error`,
          body: `${msg.slice(0, 120)}${p ? ` (${p})` : ""}`,
          url: "/admin",
          tag: `error-${fp}`,
        }).catch(() => {});
      }
    }
  } catch {
    // if the database is the problem, the log line is all we can do
  }
}
