/**
 * safeLog.ts — keep personal data out of the logs.
 *
 * Database errors carry the values involved ("Key (email)=(a@b.com) already exists",
 * query parameters), and logged Error objects print every field. Once installed, errors
 * passed to console.error / console.warn are reduced to name, code, a trimmed message
 * and the first stack frames; anything that looks like an email, API key or token in
 * a logged string is masked.
 */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET = /\b(gsk_[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+|enc:v1:[A-Za-z0-9_:-]+)/g;

export function scrub(text: string): string {
  return text.replace(EMAIL, "[email]").replace(SECRET, "[secret]");
}

export function safeError(err: unknown): unknown {
  if (!(err instanceof Error)) return typeof err === "string" ? scrub(err) : err;
  const e = err as Error & { code?: string; status?: number };
  return {
    name: e.name,
    ...(e.code ? { code: e.code } : {}),
    ...(e.status ? { status: e.status } : {}),
    message: scrub(String(e.message)).slice(0, 300),
    stack: e.stack?.split("\n").slice(1, 4).map((l) => l.trim()).join(" | "),
  };
}

let installed = false;
/** Wrap console.error / console.warn once, for the whole process. */
export function installSafeConsole(): void {
  if (installed) return;
  installed = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => original(...args.map((a) => (a instanceof Error || typeof a === "string" ? safeError(a) : a)));
  }
}
