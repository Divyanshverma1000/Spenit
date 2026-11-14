/**
 * storyParse.ts — "we went to the mall, I bought a jacket for 5500, Ankit paid 5600 for
 * dinner…" turned into separate bills, checked before anyone sees them.
 *
 * The model proposes; this keeps only what holds up:
 *   - people must be group members (by id); unknown ids are dropped, never guessed
 *   - a bill with no clear payer keeps payer = null and a question, so the app ASKS
 *   - "extras" are one person's own add-on inside a shared bill (the ice cream at dinner):
 *     they must belong to someone in the bill and leave something to share
 *   - category falls back to plain words (a cab is Travel)
 * Pure; tested in storyParse.test.ts.
 */
import { categoryFromText } from "./expenseText";

export interface StoryBill {
  key: string;
  description: string;
  amount: number;
  category: string;
  /** null = the story didn't say; the app asks */
  paidBy: string | null;
  question: string | null;
  sharedBy: string[];
  extras: { userId: string; amount: number; what: string }[];
  /** the words this bill came from, shown so people can check it */
  quote: string;
}

const CATS = ["Food", "Travel", "Shopping", "Stay", "Fuel", "Medical", "Utilities", "Entertainment", "Misc"];
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const str = (v: unknown, n = 80) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function cleanStory(raw: unknown, memberIds: string[]): { bills: StoryBill[]; unclear: string[] } {
  const ids = new Set(memberIds);
  const r = (raw && typeof raw === "object" ? raw : {}) as { bills?: unknown; unclear?: unknown };
  const bills: StoryBill[] = [];
  for (const [i, b] of (Array.isArray(r.bills) ? r.bills : []).entries()) {
    const x = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const amount = num(x.amount);
    if (amount <= 0) continue;
    const description = str(x.description, 60) || "Expense";
    const quote = str(x.quote, 240);
    const sharedRaw = Array.isArray(x.sharedBy) ? (x.sharedBy as unknown[]).filter((u): u is string => typeof u === "string" && ids.has(u)) : [];
    const sharedBy = sharedRaw.length ? Array.from(new Set(sharedRaw)) : [...memberIds];
    const paid = typeof x.paidBy === "string" && ids.has(x.paidBy) ? x.paidBy : null;
    let extras = (Array.isArray(x.extras) ? x.extras : [])
      .map((e) => (e && typeof e === "object" ? e : {}) as Record<string, unknown>)
      .map((e) => ({ userId: String(e.userId ?? ""), amount: num(e.amount), what: str(e.what, 40) }))
      .filter((e) => sharedBy.includes(e.userId) && e.amount > 0);
    // Extras must leave something to share, and only make sense with 2+ people.
    if (sharedBy.length < 2 || extras.reduce((a, e) => a + e.amount, 0) >= amount) extras = [];
    // one entry per person
    const merged = new Map<string, { userId: string; amount: number; what: string }>();
    for (const e of extras) {
      const m = merged.get(e.userId);
      merged.set(e.userId, m ? { ...m, amount: Math.round((m.amount + e.amount) * 100) / 100, what: [m.what, e.what].filter(Boolean).join(", ") } : e);
    }
    const cat = CATS.includes(String(x.category)) && x.category !== "Misc" ? String(x.category) : categoryFromText(`${description} ${quote}`) ?? "Misc";
    bills.push({
      key: `b${i + 1}`,
      description: description.charAt(0).toUpperCase() + description.slice(1),
      amount,
      category: cat,
      paidBy: paid,
      question: paid ? null : str(x.question, 100) || `Who paid for the ${description.toLowerCase()}?`,
      sharedBy,
      extras: [...merged.values()],
      quote,
    });
  }
  const unclear = (Array.isArray(r.unclear) ? r.unclear : []).map((u) => str(u, 120)).filter(Boolean).slice(0, 5);
  return { bills: bills.slice(0, 25), unclear };
}
