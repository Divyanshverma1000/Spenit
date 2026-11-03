import pool from "./db/pool";

/**
 * Real database activity, on a schedule.
 *
 * Supabase's free plan pauses a project that gets too little database activity over a week, and
 * nothing resumes it automatically. During a quiet stretch (exams, holidays) our users might not
 * generate that activity, so the app produces some itself: a cheap read plus the cleanup below,
 * every few hours. Returns true when the database answered.
 */
export async function databaseHeartbeat(): Promise<boolean> {
  try {
    const r = await pool.query('SELECT count(*)::int AS users FROM "User"');
    console.log(`[heartbeat] database ok (${r.rows[0].users} users)`);
    return true;
  } catch (err) {
    console.error("[heartbeat] DATABASE UNREACHABLE. If it is a paused Supabase project, resume it in the Supabase dashboard:", (err as Error).message);
    return false;
  }
}

/** Idempotency keys only need to outlive client retries; keep them for 7 days. */
export async function cleanupIdempotencyKeys(): Promise<void> {
  try {
    const r = await pool.query(`DELETE FROM "IdempotencyKey" WHERE created_at < now() - interval '7 days'`);
    if (r.rowCount) console.log(`[housekeeping] removed ${r.rowCount} old idempotency keys`);
  } catch (err) {
    console.warn("[housekeeping] idempotency cleanup skipped:", (err as Error).message);
  }
}

/** Everything periodic, in one call (Worker cron trigger / Node interval). */
export async function runHousekeeping(): Promise<void> {
  if (await databaseHeartbeat()) await cleanupIdempotencyKeys();
}
