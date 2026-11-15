/**
 * story.ts — a day told as a story, after the server split it into bills (POST /ai/parse-story).
 * Shares per bill, what the whole day means for each person, and the bodies to save.
 * Pure; tested in story.test.ts.
 */
import { splitWithItems, type SpecificItem } from "./itemSplit";

export interface StoryBill {
  key: string;
  description: string;
  amount: number;
  category: string;
  paidBy: string | null;
  question: string | null;
  sharedBy: string[];
  /** items only some people had (taken off first, the rest is split): an extra dessert, a heater for two */
  extras: SpecificItem[];
  quote: string;
  /** set on the review screen */
  skip?: boolean;
  /** "Only you" bills: save to Personal spending instead of the group */
  toPersonal?: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Two or more amounts in what was said or typed: treat it as a story of several bills. */
export function looksLikeStory(text: string): boolean {
  const amounts = text.replace(/,(?=\d{3})/g, "").match(/(?:₹|rs\.?\s*)?\b\d{2,}(?:\.\d+)?\s*k?\b/gi) ?? [];
  return amounts.length >= 2;
}

/** What /ai/parse-story returns per bill: extras are one person each. */
export type ServerStoryBill = Omit<StoryBill, "extras"> & { extras?: { userId: string; amount: number; what: string }[] };

/** Server bills in the review screen's shape (each extra becomes an editable item). */
export function fromServer(bills: ServerStoryBill[]): StoryBill[] {
  return bills.map((b) => ({
    ...b,
    extras: (b.extras ?? []).map((e, i) => ({ id: `${b.key}-x${i}`, label: e.what, amount: String(e.amount), sharedBy: [e.userId] })),
  }));
}

/** Each person's part: the items they had, plus an equal slice of the rest. Adds up to the bill. */
export function sharesOf(b: Pick<StoryBill, "amount" | "sharedBy" | "extras">): Record<string, number> {
  return splitWithItems(b.amount, b.extras, b.sharedBy).shares;
}

/**
 * The day for each person: what they paid, their share, and the difference
 * (+ = gets money back, − = owes). Skipped bills, bills saved as personal spending and
 * bills still missing a payer are left out.
 */
export function dayTotals(bills: StoryBill[]) {
  const people: Record<string, { paid: number; share: number; net: number }> = {};
  const get = (u: string) => (people[u] ??= { paid: 0, share: 0, net: 0 });
  let total = 0;
  for (const b of bills) {
    if (b.skip || b.toPersonal) continue;
    total += b.amount;
    if (!b.paidBy) continue;
    get(b.paidBy).paid += b.amount;
    for (const [u, s] of Object.entries(sharesOf(b))) get(u).share += s;
  }
  for (const p of Object.values(people)) { p.paid = r2(p.paid); p.share = r2(p.share); p.net = r2(p.paid - p.share); }
  return { total: r2(total), people };
}

/**
 * Body for POST /expenses/batch: exact shares (items first, the rest equally), with the
 * items kept as the bill's record so the detail view and "Repeat" show them.
 */
export function toExpenseBody(b: StoryBill) {
  const items = b.extras.filter((e) => (parseFloat(e.amount) || 0) > 0 && e.sharedBy.length > 0);
  return {
    description: b.description,
    amount: b.amount,
    currency: "INR",
    splitType: "exact" as const,
    category: b.category,
    payers: [{ userId: b.paidBy!, amountPaid: b.amount }],
    participants: Object.entries(sharesOf(b)).filter(([, v]) => v > 0).map(([userId, shareAmount]) => ({ userId, shareAmount })),
    ...(items.length ? { receiptData: items } : {}),
  };
}
