/**
 * Is this error "the database can't be reached right now" (paused, waking up, network blip)
 * as opposed to a bug or a bad query? Used to answer 503 "try again" instead of a scary 500.
 */
const NETWORK_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "EPIPE",
]);
// Postgres classes: 08 connection exception, 57P admin/crash shutdown, 53300 too many connections
const PG_UNAVAILABLE = /^(08|57P0|53300)/;
const MESSAGE_HINTS = [
  "connection attempt failed", // Cloudflare Workers socket error
  "network connection lost",
  "connection refused",
  "connection terminated",
  "connection timeout",
  "timeout exceeded when trying to connect",
  "connect timeout",
  "cannot connect to the specified address", // Cloudflare: proxy request failed
  "proxy request failed",
  "failed to acquire a connection",
  "the database system is starting up",
  "the database system is shutting down",
  "no database",
  "server closed the connection",
  "self-signed certificate", // wrong TLS settings are a config problem, but still "can't use the database"
];

export function isDbUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; cause?: unknown };
  if (e.code && (NETWORK_CODES.has(e.code) || PG_UNAVAILABLE.test(e.code))) return true;
  const msg = (e.message || "").toLowerCase();
  if (MESSAGE_HINTS.some((h) => msg.includes(h))) return true;
  return e.cause ? isDbUnavailable(e.cause) : false;
}
