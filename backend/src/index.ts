/**
 * Node entry point (Render, Docker, local development).
 * The Cloudflare Workers entry point is worker.ts; both build the same app (app.ts).
 */
import { isProd, validateEnv } from "./config";

validateEnv();

import pool from "./db/pool";
import { getRedis } from "./db/redis";
import { buildApp } from "./app";
import { runHousekeeping } from "./housekeeping";

const PORT = process.env.PORT || 4000;
const app = buildApp({ compress: true });

// A rejected promise nobody awaited must not take the whole API down.
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection:", reason);
});

// ── Start server ──────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`✅  Spenit backend running on port ${PORT} (${isProd ? "production" : "development"})`);
  console.log(`   Ping:     GET  /ping`);
  console.log(`   Health:   GET  /health`);
  getRedis(); // connect early if REDIS_URL is configured
  runHousekeeping();
  setInterval(runHousekeeping, 4 * 60 * 60 * 1000).unref();
});

// ── Graceful shutdown (Render sends SIGTERM on every deploy / restart) ────────
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[process] ${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  server.close(async () => {
    try { await pool.end(); } catch {}
    try { await getRedis()?.quit(); } catch {}
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
