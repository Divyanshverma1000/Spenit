/**
 * peopleStage.ts — where each person is with Spenit, for the admin People view.
 *
 *   hooked    used it on 4+ different days in the last 2 weeks: they find it useful
 *   new       signed up in the last 7 days, not hooked yet
 *   regular   came back in the last 7 days
 *   drifting  last seen 8–21 days ago
 *   quiet     not seen for more than 3 weeks
 *   never     signed up, never used it after that
 *
 * Pure; tested in peopleStage.test.ts.
 */
export type Stage = "hooked" | "new" | "regular" | "drifting" | "quiet" | "never";

const DAY_MS = 86_400_000;

/** activeAgo: for each day they used the app in the last 30, how many days ago (0 = today). */
export function stageOf(p: { createdAt: Date; lastSeenAt: Date | null; activeAgo: number[] }, now = new Date()): Stage {
  const recentDays = new Set(p.activeAgo.filter((d) => d < 14)).size;
  if (recentDays >= 4) return "hooked";
  const age = (now.getTime() - p.createdAt.getTime()) / DAY_MS;
  if (age < 7) return "new";
  if (!p.lastSeenAt || p.lastSeenAt.getTime() - p.createdAt.getTime() < 10 * 60_000) return "never";
  const since = (now.getTime() - p.lastSeenAt.getTime()) / DAY_MS;
  if (since <= 7) return "regular";
  if (since <= 21) return "drifting";
  return "quiet";
}

/**
 * How useful Spenit is to them, 0–100, from what they did (not what they wrote):
 * days they came back, bills they added, scans, payments settled, AI questions, groups.
 */
export function usefulness(p: {
  activeAgo: number[]; bills: number; imports: number; payments: number; groups: number; chats: number; personal: number;
}): number {
  const days = new Set(p.activeAgo).size; // of the last 30
  const score =
    Math.min(days, 15) * 3 + // coming back matters most (max 45)
    Math.min(p.bills, 20) * 1 + // max 20
    Math.min(p.imports, 10) * 1 + // max 10
    Math.min(p.payments, 5) * 2 + // max 10
    Math.min(p.groups, 3) * 2 + // max 6
    Math.min(p.chats, 9) * 0.5 + // max 4.5
    Math.min(p.personal, 9) * 0.5; // max 4.5
  return Math.round(Math.min(100, score));
}
