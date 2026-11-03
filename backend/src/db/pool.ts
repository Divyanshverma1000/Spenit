import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

/**
 * The database handle used everywhere (`import pool from "./db/pool"`).
 *
 * It is a thin delegate so the same route code runs on two runtimes:
 *  - Node (Render, Docker, local): a normal pg Pool, created on first use.
 *  - Cloudflare Workers: worker.ts installs a per-request implementation
 *    (see workerPool.ts). Workers cannot share sockets between requests, so a
 *    long-lived Pool is not possible there.
 *
 * Route code only uses `query()` and `connect()` (for transactions), which both
 * implementations provide.
 */
export interface PoolImpl {
  query: Pool["query"];
  connect: Pool["connect"];
  end: () => Promise<void>;
}

let impl: PoolImpl | null = null;

/** Called once by the Workers entry point. Node never calls this. */
export function installPool(custom: PoolImpl) {
  impl = custom;
}

function nodePool(): PoolImpl {
  // Hosted Postgres (Neon, Supabase, Render...) requires TLS; local Docker does not.
  // Set DATABASE_SSL=true in the hosted environment.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    // Free hosted Postgres allows few connections: keep the pool small.
    max: Number(process.env.DATABASE_POOL_MAX || 8),
    idleTimeoutMillis: 30_000,
    // A paused/auto-suspended free database can take several seconds to wake up.
    connectionTimeoutMillis: 15_000,
  });
  pool.on("error", (err) => {
    console.error("Unexpected Postgres pool error:", err.message);
  });
  return {
    query: pool.query.bind(pool) as Pool["query"],
    connect: pool.connect.bind(pool) as Pool["connect"],
    end: () => pool.end(),
  };
}

function current(): PoolImpl {
  if (!impl) impl = nodePool();
  return impl;
}

const pool = {
  query: ((...args: unknown[]) => (current().query as (...a: unknown[]) => unknown)(...args)) as Pool["query"],
  connect: ((...args: unknown[]) => (current().connect as (...a: unknown[]) => unknown)(...args)) as Pool["connect"],
  end: () => (impl ? impl.end() : Promise.resolve()),
};

export default pool as unknown as Pool;
