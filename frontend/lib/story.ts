/**
 * story.ts — a day told as a story, after the server split it into bills (POST /ai/parse-story).
 * Shares per bill, what the whole day means for each person, and the bodies to save.
 * Pure; tested in story.test.ts.
 */

export interface StoryBill {
  key: string;
  description: string;
  amount: number;
  category: string;
  paidBy: string | null;
  question: string | null;
  sharedBy: string[];
  extras: { userId: string; amount: number; what: string }[];
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

function exactShares(b: Pick<StoryBill, "amount" | "sharedBy" | "extras">): Record<string, number> {
  const extra = (u: string) => b.extras.filter((e) => e.userId === u).reduce((a, e) => a + e.amount, 0);
  const pool = b.amount - b.extras.reduce((a, e) => a + e.amount, 0);
  const each = b.sharedBy.length ? pool / b.sharedBy.length : 0;
  return Object.fromEntries(b.sharedBy.map((u) => [u, extra(u) + each]));
}

/** Each sharer's part: their extras, plus an equal slice of the rest. */
export function sharesOf(b: Pick<StoryBill, "amount" | "sharedBy" | "extras">): Record<string, number> {
  return Object.fromEntries(Object.entries(exactShares(b)).map(([u, v]) => [u, r2(v)]));
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
    for (const [u, s] of Object.entries(exactShares(b))) get(u).share += s;
  }
  for (const p of Object.values(people)) { p.paid = r2(p.paid); p.share = r2(p.share); p.net = r2(p.paid - p.share); }
  return { total: r2(total), people };
}

/** Body for POST /expenses/batch: personal amounts first, the rest split equally ("fairshare"). */
export function toExpenseBody(b: StoryBill) {
  const extra = (u: string) => r2(b.extras.filter((e) => e.userId === u).reduce((a, e) => a + e.amount, 0));
  return {
    description: b.description,
    amount: b.amount,
    currency: "INR",
    splitType: "fairshare" as const,
    category: b.category,
    payers: [{ userId: b.paidBy!, amountPaid: b.amount }],
    participants: b.sharedBy.map((u) => ({ userId: u, ...(extra(u) > 0 ? { personalAmount: extra(u) } : {}) })),
  };
}
