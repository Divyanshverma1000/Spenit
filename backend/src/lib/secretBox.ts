/**
 * secretBox.ts — encrypt secrets people give us (their own AI API key) before they
 * touch the database. AES-256-GCM with a key derived from the AI_KEY_SECRET server
 * secret; stored as "enc:v1:<iv>:<ciphertext>" (base64url). Web Crypto, so it runs the
 * same on Cloudflare Workers and Node.
 *
 * A database copy alone is then useless for stealing keys. Values saved before this
 * existed are plain text: open() passes them through, and they're upgraded by
 * upgradePlainKeys() (housekeeping) or the next time they're saved.
 */
import type { PoolClient } from "pg";

type CryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
const PREFIX = "enc:v1:";
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64url");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

let cached: { secret: string; key: Promise<CryptoKey> } | null = null;
function key(): Promise<CryptoKey> | null {
  const secret = process.env.AI_KEY_SECRET;
  if (!secret) return null;
  if (cached?.secret !== secret) {
    cached = {
      secret,
      key: crypto.subtle
        .digest("SHA-256", enc.encode(`spenit/ai-key/v1/${secret}`))
        .then((raw) => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"])),
    };
  }
  return cached.key;
}

export const isSealed = (v: string | null | undefined) => !!v && v.startsWith(PREFIX);

/** Encrypt. Without AI_KEY_SECRET configured the value is stored as is (and config warns). */
export async function seal(plain: string): Promise<string> {
  const k = key();
  if (!k) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await k, enc.encode(plain));
  return `${PREFIX}${b64(iv)}:${b64(ct)}`;
}

/** Decrypt (plain-text legacy values pass through). Null if it can't be read. */
export async function open(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  if (!isSealed(stored)) return stored;
  const k = key();
  if (!k) return null;
  const [iv, ct] = stored.slice(PREFIX.length).split(":");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await k, unb64(ct));
    return dec.decode(pt);
  } catch {
    return null; // wrong secret or tampered value
  }
}

/** Encrypt any AI keys still stored as plain text. Returns how many were upgraded. */
export async function upgradePlainKeys(db: Pick<PoolClient, "query">, limit = 500): Promise<number> {
  if (!key()) return 0;
  const { rows } = await db.query(
    `select id, groq_api_key from "User" where groq_api_key is not null and groq_api_key not like 'enc:v1:%' limit $1`,
    [limit]
  );
  for (const r of rows as { id: string; groq_api_key: string }[]) {
    await db.query('update "User" set groq_api_key = $2 where id = $1 and groq_api_key = $3', [r.id, await seal(r.groq_api_key), r.groq_api_key]);
  }
  return rows.length;
}
