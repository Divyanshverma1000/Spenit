"use client";

/**
 * trail.ts — the last few screens visited (this tab only), so "Report a problem" from
 * Profile can say which screen the problem was really on. Paths only, ids blanked by the
 * server; nothing leaves the phone except with a report the person chose to send.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const KEY = "spenit-trail";
const SKIP = new Set(["/profile", "/admin", "/testing", "/about", "/privacy", "/terms"]);

function read(): string[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch { return []; }
}

/** Mount once (Providers): records each screen as it opens. */
export function RouteTrail() {
  const path = usePathname();
  useEffect(() => {
    if (!path) return;
    try {
      const t = read().filter((p) => p !== path);
      t.push(path);
      sessionStorage.setItem(KEY, JSON.stringify(t.slice(-6)));
    } catch { /* private mode */ }
  }, [path]);
  return null;
}

/** The screen someone was on before opening Profile / Admin, or null. */
export function lastScreen(): string | null {
  const t = read().filter((p) => !SKIP.has(p));
  return t.length ? t[t.length - 1] : null;
}

/** "/groups/:id/import" → "Scan & upload" (paths as stored, ids blanked). */
export function screenName(path: string | null): string {
  if (!path) return "Unknown screen";
  const p = path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id").replace(/\/+$/, "") || "/";
  const names: [RegExp, string][] = [
    [/^\/groups\/:id\/import/, "Scan & upload"],
    [/^\/groups\/:id\/expenses\/ai/, "AI Expense"],
    [/^\/groups\/:id\/expenses\/new/, "Add expense"],
    [/^\/groups\/:id\/settle/, "Settle Up"],
    [/^\/groups\/:id\/balance/, "Balances"],
    [/^\/groups\/:id\/activity/, "Activity"],
    [/^\/groups\/new/, "New group"],
    [/^\/groups\/:id/, "Group page"],
    [/^\/groups$/, "Groups"],
    [/^\/personal\/chat/, "Personal chat"],
    [/^\/personal\/new/, "Add personal expense"],
    [/^\/personal/, "Personal spending"],
    [/^\/dashboard|^\/$/, "Home"],
    [/^\/profile/, "Profile"],
    [/^\/admin/, "Admin"],
    [/^\/scan/, "Scan"],
    [/^\/join/, "Join a group"],
    [/^\/g\//, "Invite link"],
    [/^\/owe\//, "Payment link"],
    [/^\/testing/, "Testing checklist"],
  ];
  return names.find(([re]) => re.test(p))?.[1] ?? p;
}
