/**
 * Cache facade.
 *
 * Everything cached here (balances) is derived data that can be recomputed from
 * Postgres at any time, so the cache is a pure optimisation and must NEVER be a
 * reason for a request to fail.
 *
 *  - No REDIS_URL  -> in-process memory cache. Right for a single instance
 *    (one Render service), needs no extra service, has no command quota.
 *  - REDIS_URL set -> Redis (e.g. Upstash). Every call is wrapped: if Redis is
 *    down, slow, or over its free quota, we fall back to memory / a cache miss.
 */

import { getRedis } from "../db/redis";

interface MemEntry {
  value: string;
  expiresAt: number;
}

const MAX_MEMORY_ENTRIES = 5000;
const memory = new Map<string, MemEntry>();

function memGet(key: string): string | null {
  const e = memory.get(key);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return e.value;
}

function memSet(key: string, value: string, ttlSeconds: number) {
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    // Drop the oldest entry (Map keeps insertion order).
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheGet(key: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    try {
      return await redis.get(key);
    } catch (err) {
      console.warn("[cache] redis get failed, using memory:", (err as Error).message);
    }
  }
  return memGet(key);
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, value, "EX", ttlSeconds);
      return;
    } catch (err) {
      console.warn("[cache] redis set failed, using memory:", (err as Error).message);
    }
  }
  memSet(key, value, ttlSeconds);
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  keys.forEach((k) => memory.delete(k));
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(...keys);
    } catch (err) {
      console.warn("[cache] redis del failed:", (err as Error).message);
    }
  }
}

/** For /health: which backend is in use and is it reachable? */
export async function cacheStatus(): Promise<{ kind: "redis" | "memory"; ok: boolean }> {
  const redis = getRedis();
  if (!redis) return { kind: "memory", ok: true };
  try {
    return { kind: "redis", ok: (await redis.ping()) === "PONG" };
  } catch {
    return { kind: "redis", ok: false };
  }
}
