/**
 * strictLimit.ts — an exact limit shared by every server instance, counted in Postgres.
 *
 * Cloudflare runs many copies of the API and its own rate limiter is approximate, so a
 * fast client is never stopped by either. This is for the few limits that must hold:
 * AI calls (they cost money and share the Groq quota). One upsert per check.
 */
import type { NextFunction, Request, Response } from "express";
import pool from "../db/pool";

/** Count one hit; true while within `limit` for the current window. */
export async function hit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; count: number; retryAfter: number }> {
  const now = Date.now();
  const start = Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
  const { rows } = await pool.query(
    `insert into "RateCounter" (key, window_start, count) values ($1, to_timestamp($2 / 1000.0), 1)
     on conflict (key, window_start) do update set count = "RateCounter".count + 1
     returning count`,
    [key, start]
  );
  const count = Number(rows[0]?.count ?? 0);
  return { ok: count <= limit, count, retryAfter: Math.ceil((start + windowSeconds * 1000 - now) / 1000) };
}

/** Express guard for signed-in routes: per account, several windows at once. */
export function strictLimit(name: string, windows: { limit: number; seconds: number; message: string }[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user?.userId;
    if (!user) return next();
    try {
      for (const w of windows) {
        const r = await hit(`${name}:${w.seconds}:${user}`, w.limit, w.seconds);
        if (!r.ok) {
          res.setHeader("Retry-After", String(r.retryAfter));
          res.status(429).json({ error: w.message, reason: "rate_limit", retryAfterMs: r.retryAfter * 1000 });
          return;
        }
      }
    } catch (err) {
      console.warn("[ratelimit] strict limit check failed:", (err as Error).message); // never block on our own failure
    }
    next();
  };
}

/** Drop finished windows (housekeeping). */
export async function cleanupRateCounters(): Promise<void> {
  await pool.query(`delete from "RateCounter" where window_start < now() - interval '2 days'`);
}
