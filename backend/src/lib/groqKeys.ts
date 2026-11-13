/**
 * groqKeys.ts — a person's Groq keys: the main one plus up to MAX_EXTRA_GROQ_KEYS extras.
 *
 * Extras only speed up big screenshot imports: each screenshot is read with one key
 * ("lane"), so with 3 keys three screenshots are read side by side. Groq counts its limits
 * per Groq account (organisation), so extras only help when they come from different accounts.
 * Every key is stored sealed (lib/secretBox) and opened only for the request at hand.
 */
import pool from "../db/pool";
import { open as openSecret, seal } from "./secretBox";

export const MAX_EXTRA_GROQ_KEYS = 4;

export function maskKey(key: string): string {
  return key.startsWith("gsk_") && key.length > 8 ? `gsk_***${key.slice(-4)}` : "***";
}

/** Plain-text check before saving: no spaces, not absurdly long. */
export function badKey(k: string): boolean {
  return k.length < 8 || k.length > 200 || /\s/.test(k);
}

function sealedList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
}

/** The person's own keys, opened: main first, then extras. Unreadable ones are skipped. */
export async function userGroqKeys(userId: string): Promise<{ main: string | null; extras: string[] }> {
  const { rows } = await pool.query(`select groq_api_key, groq_extra_keys from "User" where id = $1`, [userId]);
  const main = (await openSecret(rows[0]?.groq_api_key as string | null | undefined)) ?? null;
  const opened = await Promise.all(sealedList(rows[0]?.groq_extra_keys).map((s) => openSecret(s)));
  return { main, extras: opened.filter((k): k is string => !!k) };
}

/** Adds an extra key. Errors are messages for the person. */
export async function addExtraKey(userId: string, key: string): Promise<string | null> {
  const { main, extras } = await userGroqKeys(userId);
  if (!main) return "Add your main Groq key first";
  if (key === main || extras.includes(key)) return "You've already added this key";
  if (extras.length >= MAX_EXTRA_GROQ_KEYS) return `You can add up to ${MAX_EXTRA_GROQ_KEYS} extra keys`;
  const sealed = await Promise.all([...extras, key].map((k) => seal(k)));
  await pool.query(`update "User" set groq_extra_keys = $2::jsonb where id = $1`, [userId, JSON.stringify(sealed)]);
  return null;
}

/** Removes the extra key at `index` (as listed by GET /users/me). */
export async function removeExtraKey(userId: string, index: number): Promise<void> {
  const { extras } = await userGroqKeys(userId);
  if (!Number.isInteger(index) || index < 0 || index >= extras.length) return;
  const sealed = await Promise.all(extras.filter((_, i) => i !== index).map((k) => seal(k)));
  await pool.query(`update "User" set groq_extra_keys = $2::jsonb where id = $1`, [userId, JSON.stringify(sealed)]);
}
