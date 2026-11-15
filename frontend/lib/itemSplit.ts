/**
 * itemSplit.ts: "items first, then split the rest". A bill's total, a few items that only
 * some people had (an ice cream for Shan, a heater for two), and everyone else's equal
 * slice of what's left. This is what people do on a calculator after a dinner; Spenit
 * does it here. Works in paise, so the shares always add up to the bill exactly.
 * Pure; tested in itemSplit.test.ts.
 */
import type { SpecificItem } from "./repeat";

export type { SpecificItem };

const paise = (s: string | number) => Math.round((typeof s === "number" ? s : parseFloat(s) || 0) * 100);

/** Split `cents` over `people` as evenly as paise allow (the first few get one paisa more). */
function spread(out: Record<string, number>, cents: number, people: string[]) {
  if (cents <= 0 || people.length === 0) return;
  const base = Math.floor(cents / people.length);
  let left = cents - base * people.length;
  for (const u of people) {
    out[u] = (out[u] ?? 0) + base + (left > 0 ? 1 : 0);
    left--;
  }
}

export interface ItemSplit {
  /** each person's share in rupees; adds up to the total when `ok` */
  shares: Record<string, number>;
  /** sum of the items that have at least one person */
  itemsTotal: number;
  /** what's left for the equal split */
  rest: number;
  /** one person's slice of the rest (the largest, if paise don't divide evenly) */
  each: number;
  /** items with an amount but nobody picked yet: they're left in the rest until someone is */
  unassigned: number;
  /** the items cost more than the bill */
  over: boolean;
}

export function splitWithItems(total: number | string, items: SpecificItem[], restBy: string[]): ItemSplit {
  const cents: Record<string, number> = {};
  const totalC = paise(total);
  let itemsC = 0;
  let unassigned = 0;
  for (const it of items) {
    const c = paise(it.amount);
    if (c <= 0) continue;
    if (it.sharedBy.length === 0) { unassigned++; continue; }
    itemsC += c;
    spread(cents, c, it.sharedBy);
  }
  const restC = Math.max(0, totalC - itemsC);
  spread(cents, restC, restBy);
  const shares = Object.fromEntries(Object.entries(cents).map(([u, c]) => [u, c / 100]));
  return {
    shares,
    itemsTotal: itemsC / 100,
    rest: restC / 100,
    each: restBy.length ? Math.ceil(restC / restBy.length) / 100 : 0,
    unassigned,
    over: itemsC > totalC,
  };
}

/** A new, empty item row. */
export const newItem = (sharedBy: string[] = []): SpecificItem => ({ id: crypto.randomUUID(), label: "", amount: "", sharedBy });
