import { recordError } from "./lib/telemetry";
import adminRouter from "./routes/admin";
import feedbackRouter from "./routes/feedback";
import { installSafeConsole } from "./lib/safeLog";
import "express-async-errors"; // makes errors thrown in async route handlers reach the error middleware instead of crashing the process
import express, { NextFunction, Request, RequestHandler, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";

import { allowedOrigins, isProd } from "./config";
import pool from "./db/pool";
import { cacheStatus } from "./lib/cache";
import { isDbUnavailable } from "./lib/dbErrors";
import authRouter from "./routes/auth";
import usersRouter from "./routes/users";
import groupsRouter from "./routes/groups";
import expensesRouter from "./routes/expenses";
import balanceRouter from "./routes/balance";
import settlementsRouter from "./routes/settlements";
import pushRouter from "./routes/push";
import aiRouter from "./routes/ai";
import personalExpensesRouter from "./routes/personal_expenses";
import oweRouter from "./routes/owe";

/** Cloudflare's rate limiting binding: counts are shared by every Worker instance. */
export interface EdgeRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AppOptions {
  /** Shared rate limiters by name (Workers); without them each instance counts on its own. */
  rateLimiters?: Partial<Record<"global" | "auth" | "ai" | "write" | "public", EdgeRateLimiter>>;
  /** gzip responses. Node does it here; Cloudflare compresses at the edge, so it turns this off. */
  compress?: boolean;
  /** Runs first on every request (the Workers entry uses it to open a per-request DB scope). */
  beforeAll?: RequestHandler[];
}

/**
 * Rate-limit key: the real client IP. Through the Vercel proxy the first X-Forwarded-For
 * entry is the browser's address; directly on Cloudflare it is CF-Connecting-IP.
 */
const clientKey = (req: Request): string => {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  const cf = req.headers["cf-connecting-ip"];
  return first || (Array.isArray(cf) ? cf[0] : cf) || req.ip || "unknown";
};

/**
 * Rate limiters are created on the FIRST REQUEST, not at start-up: express-rate-limit starts a timer
 * when it is constructed, and Cloudflare Workers forbid timers in the global scope.
 */
const limiter = (windowMs: number, limit: number, message: string, key: (req: Request) => string = clientKey): RequestHandler => {
  let instance: RequestHandler | undefined;
  return (req, res, next) => {
    instance ??= rateLimit({
      windowMs,
      limit,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      keyGenerator: key,
      // We deliberately key on the forwarded address, which these checks don't understand.
      validate: { keyGeneratorIpFallback: false, xForwardedForHeader: false, trustProxy: false, creationStack: false },
      message: { error: message },
    });
    return instance(req, res, next);
  };
};

/**
 * Two layers, per minute: an exact in-memory count in each server instance (stops a fast
 * client at once), and, on Workers, Cloudflare's shared limiter (approximate and eventually
 * consistent per location, so it catches clients spread over many instances).
 */
let limiterWarned = false;
const shared = (
  edge: EdgeRateLimiter | undefined,
  perMinute: number,
  message: string,
  key: (req: Request) => string = clientKey
): RequestHandler => {
  const local = limiter(60 * 1000, perMinute, message, key);
  if (!edge) return local;
  const edgeCheck: RequestHandler = async (req, res, next) => {
    try {
      const { success } = await edge.limit({ key: `${perMinute}:${key(req)}` });
      res.setHeader("X-RateLimit-Policy", `${perMinute};w=60`);
      if (!success) {
        res.setHeader("Retry-After", "60");
        res.status(429).json({ error: message });
        return;
      }
    } catch (err) {
      // the limiter being down never blocks people
      if (!limiterWarned) { limiterWarned = true; console.warn("[ratelimit] edge limiter failed:", (err as Error).message); }
    }
    next();
  };
  return (req, res, next) => local(req, res, (err?: unknown) => (err ? next(err) : res.headersSent ? undefined : edgeCheck(req, res, next)));
};

/** Signed-in requests are counted per account (many people can share one Wi-Fi). */
const accountKey = (req: Request): string => {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      const payload = JSON.parse(Buffer.from(auth.split(".")[1] ?? "", "base64url").toString("utf8"));
      if (typeof payload?.userId === "string") return `u:${payload.userId}`;
    } catch { /* not a JWT: fall back to the address */ }
  }
  return `ip:${clientKey(req)}`;
};

/** Builds the Express application. No server is started here: see index.ts (Node) / worker.ts (Cloudflare). */
export function buildApp(options: AppOptions = {}) {
  installSafeConsole(); // no emails, keys or DB values in logs
  const { compress = true, beforeAll = [], rateLimiters = {} } = options;
  const app = express();

  // Behind Render / Cloudflare / the Vercel proxy.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  for (const mw of beforeAll) app.use(mw);

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } })); // JSON API: no HTML to protect, but headers are cheap
  if (compress) app.use(compression()); // gzip JSON: big win on slow mobile networks
  app.use(express.json({ limit: "10mb" })); // receipt photos arrive as base64
  app.use(cookieParser());

  const origins = allowedOrigins();
  app.use(
    cors({
      origin(origin, cb) {
        // No Origin header = server-to-server (the Vercel rewrite) or curl/health checks: allow.
        if (!origin || origins.includes(origin.replace(/\/+$/, ""))) return cb(null, true);
        return cb(null, false);
      },
      credentials: true, // required so the browser sends/receives httpOnly cookies
    })
  );

  // Light global guard against runaway clients; generous enough for many people on one shared Wi-Fi.
  app.use(shared(rateLimiters.global, 600, "Too many requests. Please slow down and try again shortly."));
  // Writes and AI are counted per account. (Keys come from the token without trusting it:
  // a forged token only changes which bucket you are counted in; requireAuth still checks it.)
  const writeLimiter = shared(rateLimiters.write, 120, "You're making changes too fast. Wait a minute and try again.", accountKey);
  app.use((req, res, next) => (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS" ? next() : writeLimiter(req, res, next)));

  // Slow / failing request log: enough to debug on free log retention without noise.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - started;
      if (res.statusCode >= 500 || ms > 1500) {
        console.warn(`[req] ${req.method} ${req.originalUrl.split("?")[0]} -> ${res.statusCode} in ${ms}ms`);
      }
    });
    next();
  });

  // ── Health ──────────────────────────────────────────────────────────────────

  /**
   * GET /ping: no database, no cache. Use this for uptime monitors: it keeps a free
   * instance awake without waking the database (which would burn the DB's free compute hours).
   */
  app.get("/ping", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  /**
   * GET /health: checks Postgres (required) and the cache (optional).
   * 200 if Postgres is reachable, 503 otherwise.
   */
  app.get("/health", async (_req: Request, res: Response) => {
    const health = {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: { postgres: "unreachable", cache: "memory" as string },
    };

    try {
      await pool.query("SELECT 1");
      health.services.postgres = "ok";
    } catch (err) {
      console.error("Postgres health check failed:", (err as Error).message);
    }

    const cache = await cacheStatus();
    health.services.cache = cache.ok ? cache.kind : `${cache.kind} (unreachable, using memory)`;

    const ok = health.services.postgres === "ok";
    health.status = ok ? "ok" : "degraded";
    res.status(ok ? 200 : 503).json(health);
  });

  // ── Routes ──────────────────────────────────────────────────────────────────
  const authLimiter = shared(rateLimiters.auth, 60, "Too many sign-in attempts. Please wait a few minutes.");
  const publicTokenLimiter = shared(rateLimiters.public, 60, "Too many requests. Please wait a few minutes.");
  const aiLimiter = shared(rateLimiters.ai, 30, "Too many AI requests. Wait a minute and try again.", accountKey);

  app.use("/auth", authLimiter, authRouter);
  app.use("/users", usersRouter);
  app.use("/groups/preview", publicTokenLimiter);
  app.use("/groups", groupsRouter);
  app.use("/expenses", expensesRouter);
  app.use("/balance", balanceRouter);
  app.use("/settlements", settlementsRouter);
  app.use("/push", pushRouter);
  app.use("/ai", aiLimiter, aiRouter);
  app.use("/personal_expenses", personalExpensesRouter);
  app.use("/owe", publicTokenLimiter, oweRouter);
  app.use("/admin", adminRouter);
  app.use("/feedback", feedbackRouter);

  // The app reports its own crashes here (no sign-in needed: a crash can happen before it).
  app.post("/telemetry/error", publicTokenLimiter, async (req: Request, res: Response) => {
    const { message, path } = (req.body ?? {}) as { message?: unknown; path?: unknown };
    if (typeof message === "string" && message.trim()) {
      await recordError("app", message.slice(0, 500), typeof path === "string" ? path.slice(0, 200) : null);
    }
    res.status(204).end();
  });

  // ── Errors ──────────────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use(async (err: Error & { status?: number; type?: string }, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON in request body" });
      return;
    }
    if (err.type === "entity.too.large") {
      res.status(413).json({ error: "That upload is too large. Try a smaller image." });
      return;
    }
    if (isDbUnavailable(err)) {
      // e.g. a paused free database or a network blip: tell clients to retry (queued expenses are kept).
      console.error(`[db] unavailable on ${req.method} ${req.originalUrl.split("?")[0]}:`, (err as Error).message);
      res.set("Retry-After", "30");
      res.status(503).json({
        error: "The database is unavailable right now. Please try again in a minute.",
        code: "DB_UNAVAILABLE",
      });
      return;
    }
    console.error(`[error] ${req.method} ${req.originalUrl.split("?")[0]}:`, err);
    if (!(err.status && err.status < 500)) await recordError("api", `${err.name}: ${err.message}`, `${req.method} ${req.route?.path ?? req.originalUrl}`);
    res.status(err.status && err.status < 500 ? err.status : 500).json({
      error: isProd ? "Something went wrong. Please try again." : err.message,
    });
  });

  return app;
}
