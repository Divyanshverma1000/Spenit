/**
 * Migrations the Worker applies by itself, once per isolate, before serving requests.
 *
 * The production database is only reachable through Hyperdrive, so a deploy can't run
 * `npm run migrate` without the database password. Instead, each migration added after the
 * Cloudflare move is bundled here (wrangler imports .sql files as text, see wrangler.jsonc)
 * and applied through the same `_migrations` table the Node runner uses, so running either
 * one is safe. Only additive, idempotent SQL belongs here.
 */
import type { NextFunction, Request, Response } from "express";
import pool from "./pool";
import m010 from "../../migrations/010_group_avatars.sql";
import m011 from "../../migrations/011_group_safety.sql";
import m012 from "../../migrations/012_consent.sql";
import m013 from "../../migrations/013_rate_counter.sql";
import m014 from "../../migrations/014_monitoring.sql";
import m015 from "../../migrations/015_personal_spending.sql";
import m016 from "../../migrations/016_feedback.sql";
import m017 from "../../migrations/017_fix_undone_claims.sql";
import m018 from "../../migrations/018_groq_extra_keys.sql";
import m019 from "../../migrations/019_user_usage.sql";
import m020 from "../../migrations/020_notification_log.sql";

const BUNDLED: { filename: string; sql: string }[] = [
  { filename: "010_group_avatars.sql", sql: m010 },
  { filename: "011_group_safety.sql", sql: m011 },
  { filename: "012_consent.sql", sql: m012 },
  { filename: "013_rate_counter.sql", sql: m013 },
  { filename: "014_monitoring.sql", sql: m014 },
  { filename: "015_personal_spending.sql", sql: m015 },
  { filename: "016_feedback.sql", sql: m016 },
  { filename: "017_fix_undone_claims.sql", sql: m017 },
  { filename: "018_groq_extra_keys.sql", sql: m018 },
  { filename: "019_user_usage.sql", sql: m019 },
  { filename: "020_notification_log.sql", sql: m020 },
];

/** Any stable 64-bit number: serialises migration runs across concurrent isolates. */
const LOCK_ID = 4_210_017;

async function applyPending(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "create table if not exists _migrations (id serial primary key, filename text unique not null, applied_at timestamptz not null default now())"
    );
    for (const m of BUNDLED) {
      await client.query("begin");
      try {
        await client.query("select pg_advisory_xact_lock($1)", [LOCK_ID]);
        const done = await client.query("select 1 from _migrations where filename = $1", [m.filename]);
        if (done.rows.length === 0) {
          await client.query(m.sql);
          await client.query("insert into _migrations (filename) values ($1)", [m.filename]);
          console.log(`[migrate] applied ${m.filename}`);
        }
        await client.query("commit");
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

let ready: Promise<void> | null = null;

/** Express middleware (after requestDbScope): waits for pending migrations on the first request. */
export function ensureMigrations(_req: Request, res: Response, next: NextFunction) {
  if (!ready) {
    ready = applyPending().catch((err) => {
      ready = null; // try again on the next request
      throw err;
    });
  }
  ready.then(
    () => next(),
    (err) => {
      console.error("[migrate] FAILED:", (err as Error).message);
      res.status(503).json({ error: "The server is updating its database. Try again in a moment." });
    }
  );
}
