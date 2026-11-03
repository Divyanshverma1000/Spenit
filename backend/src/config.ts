import dotenv from "dotenv";

dotenv.config();

export const isProd = process.env.NODE_ENV === "production";

/** Origins allowed to call the API from a browser. FRONTEND_URL may hold several, comma-separated. */
export function allowedOrigins(): string[] {
  const raw = process.env.FRONTEND_URL || (isProd ? "" : "http://localhost:3000");
  return raw
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

const looksLocal = (url: string) => /localhost|127\.0\.0\.1|\[::1\]/.test(url);

export interface EnvCheck {
  errors: string[];
  warnings: string[];
}

/**
 * Inspect the environment. Pure (no exit, no logging) so both runtimes can use it:
 * Node stops the process, a Worker answers 500 until the config is fixed.
 * `hasDatabase` lets a Worker say "a Hyperdrive binding counts as a database".
 */
export function checkEnv(opts: { runtime: "node" | "worker"; hasDatabase?: boolean } = { runtime: "node" }): EnvCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const env = process.env;
  const worker = opts.runtime === "worker";

  if (!(opts.hasDatabase ?? !!env.DATABASE_URL)) {
    errors.push(worker ? "No database: bind Hyperdrive as HYPERDRIVE or set the DATABASE_URL secret" : "DATABASE_URL is not set");
  }

  const access = env.JWT_ACCESS_SECRET;
  const refresh = env.JWT_REFRESH_SECRET;
  if (!access) errors.push("JWT_ACCESS_SECRET is not set");
  if (!refresh) errors.push("JWT_REFRESH_SECRET is not set");
  if (access && refresh && access === refresh) {
    errors.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different");
  }
  if (isProd) {
    if (access && access.length < 32) errors.push("JWT_ACCESS_SECRET must be at least 32 characters in production");
    if (refresh && refresh.length < 32) errors.push("JWT_REFRESH_SECRET must be at least 32 characters in production");
    if (access?.startsWith("replace_with") || refresh?.startsWith("replace_with")) {
      errors.push("JWT secrets are still the placeholder values from .env.example");
    }
  }

  if (!env.GOOGLE_CLIENT_ID) errors.push("GOOGLE_CLIENT_ID is not set (Google sign-in cannot work)");

  if (isProd) {
    const origins = allowedOrigins();
    if (origins.length === 0) errors.push("FRONTEND_URL is not set");
    else if (origins.some((o) => !o.startsWith("https://") && !looksLocal(o))) {
      warnings.push("FRONTEND_URL should use https:// in production");
    }
    if (!worker && env.DATABASE_URL && !looksLocal(env.DATABASE_URL) && env.DATABASE_SSL !== "true") {
      warnings.push("DATABASE_URL points at a remote database but DATABASE_SSL is not 'true'. Hosted Postgres needs TLS");
    }
  }

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    warnings.push("VAPID keys are not set: push notifications are disabled");
  }
  if (!worker && !env.REDIS_URL) {
    warnings.push("REDIS_URL is not set: using the in-memory cache (fine for a single instance)");
  }

  return { errors, warnings };
}

/**
 * Node start-up check: in production a bad config stops the process with a clear message
 * (far better than a half-working API that fails on the first login). In development it only warns.
 */
export function validateEnv(): void {
  const { errors, warnings } = checkEnv({ runtime: "node" });
  for (const w of warnings) console.warn(`[config] warning: ${w}`);

  if (errors.length > 0) {
    for (const e of errors) console.error(`[config] ERROR: ${e}`);
    if (isProd) {
      console.error("[config] Refusing to start with an invalid configuration.");
      process.exit(1);
    }
    console.error("[config] Continuing because NODE_ENV is not 'production'. Fix these before deploying.");
  }
}
