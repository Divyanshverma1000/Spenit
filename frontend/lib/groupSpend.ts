/**
 * groupSpend.ts — where a group's money actually went.
 *
 * "Spent ₹50,000" mixes three different things:
 *   everyone  bills (or items) split between the whole group
 *   some      shared by a few, e.g. shopping for 2 on a trip of 7
 *   personal  one person's own: kept in the group to track, but nobody owes anything for it
 * Imported orders are counted item by item (a shared order with private items is part
 * shared, part personal); fees and discounts follow the items. Pure; tested.
 */
import { readBill } from "./billDetails";

export interface SpendExpense {
  id: string;
  amount: string;
  receiptData?: unknown;
  payers: { userId: string; amountPaid: string }[];
  splits: { userId: string; name?: string; shareAmount: string }[];
}

export type SpendKind = "everyone" | "some" | "personal";

export interface SpendBreakdown {
  total: number;
  everyone: number;
  some: number;
  personal: number;
  /** bills by what most of their money was */
  bills: Record<SpendKind, number>;
  me: { paid: number; share: number };
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

function kindFor(people: number, memberCount: number): SpendKind {
  if (people <= 1) return "personal";
  return people >= memberCount ? "everyone" : "some";
}

/** How one bill's amount divides between the three kinds. */
export function billSpend(e: SpendExpense, memberCount: number): Record<SpendKind, number> {
  const out: Record<SpendKind, number> = { everyone: 0, some: 0, personal: 0 };
  const amount = num(e.amount);
  const bill = readBill(e.receiptData);
  const itemsTotal = bill ? bill.items.reduce((a, i) => a + i.lineTotal, 0) : 0;
  if (bill && itemsTotal > 0) {
    // Fees and discounts follow the items, so the three parts add up to the bill amount.
    const scale = amount / itemsTotal;
    for (const it of bill.items) out[kindFor(it.sharedBy.length, memberCount)] += it.lineTotal * scale;
  } else {
    const people = e.splits.filter((s) => num(s.shareAmount) > 0.004).length;
    out[kindFor(people, memberCount)] += amount;
  }
  return { everyone: r2(out.everyone), some: r2(out.some), personal: r2(out.personal) };
}

/** A bill that's entirely one person's: the person, or null. */
export function personalOwner(e: SpendExpense): { userId: string; name: string } | null {
  const bill = readBill(e.receiptData);
  if (bill && bill.items.length > 0) {
    const owners = new Set(bill.items.flatMap((i) => i.sharedBy));
    if (owners.size !== 1) return null;
  }
  const shares = e.splits.filter((s) => num(s.shareAmount) > 0.004);
  return shares.length === 1 ? { userId: shares[0].userId, name: shares[0].name ?? "" } : null;
}

export function groupSpend(expenses: SpendExpense[], memberCount: number, me: string): SpendBreakdown {
  const res: SpendBreakdown = {
    total: 0, everyone: 0, some: 0, personal: 0,
    bills: { everyone: 0, some: 0, personal: 0 },
    me: { paid: 0, share: 0 },
  };
  for (const e of expenses) {
    const part = billSpend(e, memberCount);
    res.total += num(e.amount);
    res.everyone += part.everyone;
    res.some += part.some;
    res.personal += part.personal;
    const main = (Object.keys(part) as SpendKind[]).reduce((a, b) => (part[b] > part[a] ? b : a), "everyone");
    res.bills[main]++;
    res.me.paid += e.payers.filter((p) => p.userId === me).reduce((a, p) => a + num(p.amountPaid), 0);
    res.me.share += e.splits.filter((s) => s.userId === me).reduce((a, s) => a + num(s.shareAmount), 0);
  }
  return {
    ...res,
    total: r2(res.total), everyone: r2(res.everyone), some: r2(res.some), personal: r2(res.personal),
    me: { paid: r2(res.me.paid), share: r2(res.me.share) },
  };
}

/** ₹50,000 → "₹50k", ₹1,23,456 → "₹1.2L", small amounts in full. */
export function shortINR(n: number): string {
  const a = Math.abs(n);
  if (a >= 100_000) return `₹${(n / 100_000).toFixed(a >= 1_000_000 ? 0 : 1).replace(/\.0$/, "")}L`;
  if (a >= 10_000) return `₹${Math.round(n / 1000)}k`;
  if (a >= 1_000) return `₹${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `₹${Math.round(n)}`;
}
