/**
 * Postgres for Cloudflare Workers.
 *
 * A Worker may not reuse a socket opened by another request, so there is no shared Pool.
 * Instead each incoming request gets ONE connection (opened lazily on its first query and
 * closed when the response finishes) that all of that request's `pool.query()` calls share.
 * Transactions (`pool.connect()`) get their own dedicated connection.
 *
 * In production the connection goes through Hyperdrive (binding `HYPERDRIVE`), which keeps a
 * warm regional pool to the real database, so opening a connection per request is cheap.
 * Without the binding it falls back to a direct `DATABASE_URL` secret.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { Client } from "pg";
import { env, waitUntil } from "cloudflare:workers";
import type { PoolImpl } from "./pool";

interface RequestDb {
  client?: Client;
  connecting?: Promise<Client>;
}

const scope = new AsyncLocalStorage<RequestDb>();

export function hasDatabaseConfig(): boolean {
  const e = env as unknown as { HYPERDRIVE?: { connectionString?: string }; DATABASE_URL?: string };
  return !!(e.HYPERDRIVE?.connectionString || e.DATABASE_URL);
}

function connectionString(): string {
  const e = env as unknown as { HYPERDRIVE?: { connectionString?: string }; DATABASE_URL?: string };
  const cs = e.HYPERDRIVE?.connectionString || e.DATABASE_URL;
  if (!cs) throw new Error("No database configured: bind Hyperdrive as HYPERDRIVE or set the DATABASE_URL secret");
  return cs;
}

async function openClient(): Promise<Client> {
  const client = new Client({ connectionString: connectionString() });
  client.on("error", (err) => console.warn("[db] connection error:", err.message));
  await client.connect();
  return client;
}

function closeClient(client: Client) {
  // Let the runtime finish the close after the response has been sent.
  waitUntil(client.end().catch(() => {}));
}

/** Express middleware: gives every request its own database connection scope. */
export function requestDbScope(_req: Request, res: Response, next: NextFunction) {
  const store: RequestDb = {};
  res.on("close", () => {
    if (store.client) closeClient(store.client);
    else if (store.connecting) store.connecting.then(closeClient).catch(() => {});
  });
  scope.run(store, next);
}

async function sharedClient(): Promise<Client> {
  const store = scope.getStore();
  if (!store) return openClient(); // outside a request (e.g. cron): caller must not leak it
  if (store.client) return store.client;
  if (!store.connecting) {
    store.connecting = openClient().then((c) => {
      store.client = c;
      return c;
    });
  }
  return store.connecting;
}

export function createWorkerPool(): PoolImpl {
  const query = async (...args: unknown[]) => {
    const store = scope.getStore();
    const client = await sharedClient();
    try {
      return await (client.query as (...a: unknown[]) => Promise<unknown>).apply(client, args);
    } finally {
      // One-off client (no request scope): close it straight away.
      if (!store) closeClient(client);
    }
  };

  const connect = async () => {
    const client = await openClient();
    // Same surface as pg's PoolClient for what the routes use: query() and release().
    const wrapped = Object.assign(client, {
      release: () => closeClient(client),
    });
    return wrapped;
  };

  return {
    query: query as unknown as PoolImpl["query"],
    connect: connect as unknown as PoolImpl["connect"],
    end: async () => {},
  };
}
