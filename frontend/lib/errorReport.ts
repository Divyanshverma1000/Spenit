/**
 * errorReport.ts — tell our server when the app crashes on someone's phone, so it shows
 * on the admin dashboard (and the admin gets an alert the first time each day).
 *
 * Only the error message and the page path are sent, never data from the screen. Noise
 * from browser extensions and harmless browser quirks is ignored, and a page reports at
 * most a few errors.
 */
import { API_URL } from "@/lib/api";

const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i, /Non-Error promise rejection captured/i, /AbortError/i, /Load failed$/i, /Failed to fetch$/i, /NetworkError/i];
const sent = new Set<string>();
const MAX_PER_PAGE = 5;

export function reportError(error: unknown, where?: string): void {
  try {
    if (typeof window === "undefined" || sent.size >= MAX_PER_PAGE) return;
    const e = error as { message?: string; name?: string; stack?: string } | string | null;
    const message = typeof e === "string" ? e : `${e?.name ?? "Error"}: ${e?.message ?? String(error)}`;
    if (!message || IGNORE.some((r) => r.test(message))) return;
    // A stack that points only at browser extensions isn't ours.
    if (typeof e === "object" && e?.stack && /chrome-extension:|moz-extension:|safari-extension:/.test(e.stack) && !e.stack.includes(location.origin)) return;
    const key = message.slice(0, 120);
    if (sent.has(key)) return;
    sent.add(key);
    const body = JSON.stringify({ message: message.slice(0, 500), path: where ?? location.pathname.replace(/[0-9a-f-]{36}/gi, ":id") });
    const url = `${API_URL}/telemetry/error`;
    if (!navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) {
      void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    // reporting must never cause another error
  }
}

let installed = false;
/** Catch crashes the app doesn't handle itself. */
export function installErrorReporting(): void {
  if (installed || typeof window === "undefined" || process.env.NODE_ENV !== "production") return;
  installed = true;
  window.addEventListener("error", (ev) => reportError(ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => reportError(ev.reason));
}
