/**
 * limits.ts — the sane bounds every write is checked against, in one place.
 * Anything outside them is a mistake or abuse, and is refused with a clear message
 * instead of reaching the database (where e.g. an oversized amount is a 500).
 */

/** ₹1 crore: far above any shared bill, far below numeric(12,2). */
export const MAX_AMOUNT = 10_000_000;
export const MAX_DESCRIPTION = 120;
/** item lists, fees and notes saved with an expense */
export const MAX_RECEIPT_JSON = 256 * 1024;
export const MAX_RECEIPT_IMAGES = 5;
export const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
export const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,/;

/** A positive money amount with at most 2 decimals, within MAX_AMOUNT. Null when it isn't one. */
export function parseAmount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return null;
  return n;
}

export function amountError(what = "Amount"): string {
  return `${what} must be more than ₹0 and at most ₹${MAX_AMOUNT.toLocaleString("en-IN")}, with up to 2 decimals`;
}
