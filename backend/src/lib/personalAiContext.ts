/**
 * personalAiContext.ts — what the personal assistant knows: everything the Spending tab
 * shows, as compact pre-computed text (models are bad at adding up long lists).
 *
 * "Your spending" = your own entries + your share of every group bill. Item questions
 * ("how much on milk?") are answered from the item lists inside group bills: your part of
 * an item = its price ÷ the number of people sharing it, counted only if you share it.
 * Other people's private items arrive already masked and are never named.
 * Pure; tested in personalAiContext.test.ts.
 */
import { itemKind } from "./groupAiContext";

export interface PersonalEntry { description: string; amount: number; category: string; at: string | Date }
export interface MyGroupBill {
  description: string;
  groupName: string;
  category: string | null;
  at: string | Date;
  total: number;
  myShare: number;
  receiptData: unknown; // masked for this viewer
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => `₹${r2(n).toFixed(2)}`;
const IST = (d: string | Date) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Category names as the app shows them, with words people use for them. */
export const CATEGORY_WORDS: Record<string, string> = {
  Food: "food, eating out, restaurants, snacks, chai, coffee",
  Groceries: "groceries, kirana, quick-commerce orders (Blinkit, Zepto, Instamart)",
  Travel: "travel, commute, cabs, autos, metro, trains, flights",
  Shopping: "shopping, fashion, clothes, shoes, gadgets, online orders",
  Stay: "stay and rent, hotels, PG, hostel",
  Fuel: "fuel, petrol, diesel, CNG",
  Medical: "medical, medicines, doctor, pharmacy",
  Utilities: "bills and recharge, utilities, electricity, wifi, mobile recharge",
  Entertainment: "fun, entertainment, movies, subscriptions, parties",
  Misc: "other",
};

interface Item { name: string | null; short: string | null; lineTotal: number; sharedBy: string[]; masked: boolean }
function items(rd: unknown): Item[] {
  if (!rd || typeof rd !== "object") return [];
  const list = Array.isArray(rd) ? rd : (rd as { items?: unknown }).items;
  if (!Array.isArray(list)) return [];
  return (list as Record<string, unknown>[]).map((it) => ({
    name: typeof it.name === "string" ? it.name : typeof it.label === "string" ? it.label : null,
    short: typeof it.short === "string" ? it.short : null,
    lineTotal: Number(it.lineTotal ?? it.amount) || 0,
    sharedBy: Array.isArray(it.sharedBy) ? (it.sharedBy as string[]) : [],
    masked: it.masked === true,
  }));
}

export function buildPersonalContext(input: {
  me: { id: string; name: string };
  personal: PersonalEntry[]; // newest first
  groupBills: MyGroupBill[]; // newest first, only bills with a share for me
  budget: number | null;
  today?: Date;
  budgetChars?: number;
}): string {
  const { me, personal, groupBills } = input;
  const today = IST(input.today ?? new Date());
  const thisMonth = today.slice(0, 7);
  const L: string[] = [];
  L.push(`TODAY: ${today} (India time)`, `YOU ARE: ${me.name}`);
  L.push(`MONTHLY BUDGET: ${input.budget ? inr(input.budget) : "not set"}`);
  L.push("", "CATEGORIES (name: what it covers): " + Object.entries(CATEGORY_WORDS).map(([k, v]) => `${k}: ${v}`).join(" | "));

  // ── Totals by month and category ──────────────────────────────────────────
  const months = new Map<string, { own: number; groups: number }>();
  const cats = new Map<string, { month: number; all: number }>();
  const add = (at: string | Date, amount: number, category: string, kind: "own" | "groups") => {
    const m = IST(at).slice(0, 7);
    const x = months.get(m) ?? { own: 0, groups: 0 };
    x[kind] += amount; months.set(m, x);
    const c = cats.get(category) ?? { month: 0, all: 0 };
    c.all += amount; if (m === thisMonth) c.month += amount; cats.set(category, c);
  };
  for (const p of personal) add(p.at, p.amount, p.category || "Misc", "own");
  for (const b of groupBills) add(b.at, b.myShare, b.category || "Misc", "groups");

  L.push("", "SPENDING BY MONTH (your own + your share of group bills):");
  if (months.size === 0) L.push("- nothing recorded yet");
  for (const [m, v] of [...months].sort().reverse().slice(0, 12)) {
    L.push(`- ${m}: ${inr(v.own + v.groups)} (own ${inr(v.own)}, group shares ${inr(v.groups)})`);
  }
  L.push("BY CATEGORY (this month · all time): " + [...cats].sort((a, b) => b[1].all - a[1].all).map(([k, v]) => `${k} ${inr(v.month)} · ${inr(v.all)}`).join("; "));

  // ── Items: your part, across every group bill, plus own entries by kind ──
  const kinds = new Map<string, { mine: number; mineMonth: number; times: number; bills: Set<string> }>();
  let privateMine = 0;
  for (const b of groupBills) {
    for (const it of items(b.receiptData)) {
      if (!it.sharedBy.includes(me.id) || it.sharedBy.length === 0) continue;
      const part = it.lineTotal / it.sharedBy.length;
      if (it.masked) { privateMine += part; continue; }
      const k = itemKind(it);
      if (!k) continue;
      const x = kinds.get(k) ?? { mine: 0, mineMonth: 0, times: 0, bills: new Set<string>() };
      x.mine += part; x.times++; x.bills.add(`${b.description} (${b.groupName})`);
      if (IST(b.at).slice(0, 7) === thisMonth) x.mineMonth += part;
      kinds.set(k, x);
    }
  }
  for (const p of personal) {
    const k = itemKind({ name: p.description });
    if (!k) continue;
    const x = kinds.get(k) ?? { mine: 0, mineMonth: 0, times: 0, bills: new Set<string>() };
    x.mine += p.amount; x.times++; x.bills.add("logged yourself");
    if (IST(p.at).slice(0, 7) === thisMonth) x.mineMonth += p.amount;
    kinds.set(k, x);
  }
  L.push("", "ITEMS YOU PAID FOR, grouped by what they are (your part this month · all time · times · where):");
  if (kinds.size === 0) L.push("- none");
  for (const [k, v] of [...kinds].sort((a, b) => b[1].mine - a[1].mine).slice(0, 100)) {
    L.push(`- ${k}: ${inr(v.mineMonth)} · ${inr(v.mine)} · ${v.times}x · ${[...v.bills].slice(0, 3).join(", ")}${v.bills.size > 3 ? "…" : ""}`);
  }
  if (privateMine > 0) L.push(`- (other people's private items you shared: ${inr(privateMine)})`);

  // ── Recent entries, newest first, within a size budget ───────────────────
  const budget = input.budgetChars ?? 7000;
  let used = 0;
  const lines: string[] = [];
  for (const p of personal.slice(0, 200)) {
    const l = `- ${IST(p.at)} ${clip(p.description, 50)} ${inr(p.amount)} · ${p.category || "Misc"} · logged yourself`;
    if (used + l.length > budget / 2) break;
    lines.push(l); used += l.length;
  }
  L.push("", "YOUR OWN ENTRIES (newest first):", ...(lines.length ? lines : ["- none"]));
  if (lines.length < personal.length) L.push(`…and ${personal.length - lines.length} older ones (included in the totals above)`);

  const billLines: string[] = [];
  used = 0;
  for (const b of groupBills) {
    const mine = items(b.receiptData).filter((it) => it.sharedBy.includes(me.id) && !it.masked);
    const l = `- ${IST(b.at)} "${clip(b.description, 50)}" in ${b.groupName}: bill ${inr(b.total)}, your share ${inr(b.myShare)} · ${b.category || "Misc"}` +
      (mine.length ? ` · your items: ${mine.slice(0, 12).map((it) => `${clip(it.name ?? "item", 30)} ${inr(it.lineTotal / it.sharedBy.length)}`).join("; ")}` : "");
    if (used + l.length > budget / 2) break;
    billLines.push(l); used += l.length;
  }
  L.push("", "GROUP BILLS YOU HAVE A SHARE IN (newest first):", ...(billLines.length ? billLines : ["- none"]));
  if (billLines.length < groupBills.length) L.push(`…and ${groupBills.length - billLines.length} older bills (included in the totals above)`);

  return L.join("\n");
}
