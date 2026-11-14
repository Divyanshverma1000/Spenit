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
  createdAt?: string;
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
  /** how many bills have any money of each kind (a shared order with a private item counts in both) */
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

export const KIND_KEYS: SpendKind[] = ["everyone", "some", "personal"];

/** The bills with any money of `kind` (all bills when no kind). */
export function billsOfKind<E extends SpendExpense>(expenses: E[], memberCount: number, kind?: SpendKind): E[] {
  return kind ? expenses.filter((e) => billSpend(e, memberCount)[kind] >= 0.5) : expenses;
}

// ── Time: since everyone settled, by month, all time ───────────────────────────

export interface SpendSettlement {
  amount: string;
  status: string;
  createdAt: string;
  confirmedAt?: string | null;
  fromUser: { id?: string };
  toUser: { id?: string };
}

/**
 * The last moment everyone in the group was square (every balance under ₹1), found by
 * replaying bills and confirmed payments in time order. null if that never happened after
 * the first bill. Spending after it is what the group is still sorting out.
 */
export function lastSettledAt(expenses: SpendExpense[], settlements: SpendSettlement[]): Date | null {
  type Ev = { at: number; apply: (b: Map<string, number>) => void };
  const add = (b: Map<string, number>, u: string | undefined, v: number) => { if (u) b.set(u, (b.get(u) ?? 0) + v); };
  const events: Ev[] = [
    ...expenses.filter((e) => e.createdAt).map((e) => ({
      at: new Date(e.createdAt!).getTime(),
      apply: (b: Map<string, number>) => {
        e.payers.forEach((p) => add(b, p.userId, num(p.amountPaid)));
        e.splits.forEach((x) => add(b, x.userId, -num(x.shareAmount)));
      },
    })),
    ...settlements.filter((s) => s.status === "confirmed").map((s) => ({
      at: new Date(s.confirmedAt || s.createdAt).getTime(),
      apply: (b: Map<string, number>) => { add(b, s.fromUser.id, num(s.amount)); add(b, s.toUser.id, -num(s.amount)); },
    })),
  ].sort((a, b) => a.at - b.at);
  const bal = new Map<string, number>();
  let last: number | null = null;
  let any = false;
  for (const ev of events) {
    ev.apply(bal);
    if ([...bal.values()].some((v) => Math.abs(v) >= 1)) { any = true; continue; }
    if (any) last = ev.at;
  }
  return last === null ? null : new Date(last);
}

/** "2026-11" for a bill's date, in India time. */
export function monthKey(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string, long = false): string {
  const [y, m] = key.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-IN", { month: long ? "long" : "short", timeZone: "UTC" });
  return y === new Date().getFullYear() ? name : `${name} ${String(y).slice(2)}`;
}

/** Total per month, oldest first, every month from the first bill to now (empty ones too). */
export function monthlyTotals(expenses: SpendExpense[]): { key: string; total: number; bills: number }[] {
  const by = new Map<string, { total: number; bills: number }>();
  for (const e of expenses) {
    if (!e.createdAt) continue;
    const k = monthKey(e.createdAt);
    const cur = by.get(k) ?? { total: 0, bills: 0 };
    by.set(k, { total: cur.total + num(e.amount), bills: cur.bills + 1 });
  }
  if (by.size === 0) return [];
  const keys = [...by.keys()].sort();
  const out: { key: string; total: number; bills: number }[] = [];
  let [y, m] = keys[0].split("-").map(Number);
  const [ly, lm] = monthKey(new Date().toISOString()).split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ key: k, total: r2(by.get(k)?.total ?? 0), bills: by.get(k)?.bills ?? 0 });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export type SpendPeriod = { kind: "all" } | { kind: "since"; at: Date } | { kind: "month"; key: string };

export function inPeriod(e: SpendExpense, p: SpendPeriod): boolean {
  if (p.kind === "all" || !e.createdAt) return true;
  if (p.kind === "since") return new Date(e.createdAt).getTime() > p.at.getTime();
  return monthKey(e.createdAt) === p.key;
}

export function periodLabel(p: SpendPeriod): string {
  if (p.kind === "all") return "All time";
  if (p.kind === "since") return `Since ${p.at.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  return monthLabel(p.key, true);
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
    for (const k of KIND_KEYS) if (part[k] >= 0.5) res.bills[k]++;
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
