import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

/**
 * Optional Redis client.
 *
 * Redis is only a cache (see lib/cache.ts), so it is created ONLY when REDIS_URL is
 * set. Without it the app runs on an in-memory cache and needs no Redis at all,
 * which is the recommended setup on a single free-tier instance.
 *
 * When it is configured, it must never be able to crash or stall the API:
 * no offline queue, a short command timeout, and bounded retries.
 */
let client: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (client !== undefined) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    client = null;
    return client;
  }

  try {
    client = new Redis(url, {
      retryStrategy: (times) => Math.min(times * 200, 5000),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false, // fail fast while disconnected instead of piling up commands
      commandTimeout: 1500,
      connectTimeout: 5000,
      lazyConnect: false,
    });
    client.on("error", (err) => {
      console.warn("[redis] client error:", err.message);
    });
  } catch (err) {
    // e.g. on Cloudflare Workers: run on the in-memory cache instead.
    console.warn("[redis] unavailable, using the in-memory cache:", (err as Error).message);
    client = null;
  }
  return client;
}

export default getRedis;
