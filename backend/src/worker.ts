/**
 * Cloudflare Workers entry point.
 * The Node entry point is index.ts; both build the same Express app (app.ts).
 *
 * Differences on Workers:
 *  - the database is reached through Hyperdrive, one connection per request (db/workerPool.ts)
 *  - responses are compressed by Cloudflare, so the gzip middleware is off
 *  - periodic housekeeping runs from a Cron Trigger instead of setInterval
 */
import type { NextFunction, Request, Response } from "express";
import { httpServerHandler } from "cloudflare:node";
import { installPool } from "./db/pool";
import { createWorkerPool, hasDatabaseConfig, requestDbScope } from "./db/workerPool";
import { buildApp } from "./app";
import { checkEnv, isProd } from "./config";
import { runHousekeeping } from "./housekeeping";

installPool(createWorkerPool());

// Validate the configuration once, on the first request (the environment is only
// guaranteed to be readable while handling a request). /ping always answers so a
// deployment can be checked even before the secrets are set.
let configErrors: string[] | null = null;
function configGuard(req: Request, res: Response, next: NextFunction) {
  if (configErrors === null) {
    const { errors, warnings } = checkEnv({ runtime: "worker", hasDatabase: hasDatabaseConfig() });
    warnings.forEach((w) => console.warn(`[config] warning: ${w}`));
    errors.forEach((e) => console.error(`[config] ERROR: ${e}`));
    configErrors = errors;
  }
  if (configErrors.length > 0 && isProd && req.path !== "/ping") {
    res.status(500).json({ error: "The server is not configured correctly. Check the Worker logs." });
    return;
  }
  next();
}

const app = buildApp({ compress: false, beforeAll: [configGuard, requestDbScope] });
app.listen(8080); // the port is only a routing key for httpServerHandler

const handler = httpServerHandler({ port: 8080 });

export default {
  fetch: handler.fetch,
  // Cron Trigger (see wrangler.jsonc): database heartbeat + tidy old idempotency keys.
  async scheduled(_controller: unknown, _env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runHousekeeping());
  },
};
