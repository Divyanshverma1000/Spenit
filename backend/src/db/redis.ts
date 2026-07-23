import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

/**
 * Shared Redis client singleton.
 * Import this everywhere instead of creating new Redis() instances.
 * Used for:
 *   - Idempotency key caching on POST /expenses (Architecture.md §9)
 *   - Balance caching on GET /groups/:id/balance (Architecture.md §4) [Stage 4]
 *   - Groq rate-limit counter (Stage 6)
 */
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  // Reconnect on error — don't crash the server if Redis blips briefly
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
  console.error("Redis client error:", err.message);
});

export default redis;
