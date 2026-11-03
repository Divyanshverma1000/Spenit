/**
 * itemizedSplit.ts — share computation for split_type 'itemized' (BulkOrderSplit_Plan.md §4).
 *
 * One order = one expense. The client says who shares each item; the server decides the money:
 *   1. Each item's lineTotal is split equally among its people.
 *   2. Fees minus discounts ("extras") are spread by feePolicy:
 *        proportional — by each person's item total (default; whoever bought more pays more delivery)
 *        equal        — equally among people who have items in this order
 *        payer        — all extras on the payer
 *      People with no items in the order never pay its fees.
 *   3. Largest-remainder rounding to the paisa, so shares always sum to the bill exactly.
 *
 * Pure — unit tested in itemizedSplit.test.ts.
 */

import { Decimal } from "decimal.js";

export type FeePolicy = "proportional" | "equal" | "payer";

export interface ItemizedInput {
  amount: Decimal;
  payerId: string;
  items: { lineTotal: number | string; sharedBy: string[] }[];
  fees: { amount: number | string }[];
  discounts: { amount: number | string }[];
  feePolicy: FeePolicy;
}

export type ItemizedResult =
  | { ok: true; shares: { userId: string; shareAmount: Decimal }[] }
  | { ok: false; error: string };

export function computeItemizedShares(input: ItemizedInput): ItemizedResult {
  const { amount, payerId, items, fees, discounts, feePolicy } = input;
  if (items.length === 0) return { ok: false, error: "An itemized expense needs at least one item" };

  const dec = (v: number | string) => new Decimal(v);

  // ── Item shares (exact, not yet rounded) ─────────────────────────────────
  const itemShare = new Map<string, Decimal>();
  const order: string[] = []; // stable order of first appearance
  let itemsTotal = new Decimal(0);

  for (const [i, item] of items.entries()) {
    const line = dec(item.lineTotal);
    if (!line.isFinite() || line.isNegative()) return { ok: false, error: `Item ${i + 1} has an invalid price` };
    const people = Array.from(new Set(item.sharedBy));
    if (people.length === 0) return { ok: false, error: `Item ${i + 1} has nobody sharing it` };
    itemsTotal = itemsTotal.plus(line);
    const each = line.div(people.length);
    for (const u of people) {
      if (!itemShare.has(u)) order.push(u);
      itemShare.set(u, (itemShare.get(u) ?? new Decimal(0)).plus(each));
    }
  }

  const feesTotal = fees.reduce((a, f) => a.plus(dec(f.amount)), new Decimal(0));
  const discountsTotal = discounts.reduce((a, d) => a.plus(dec(d.amount)), new Decimal(0));
  const billTotal = itemsTotal.plus(feesTotal).minus(discountsTotal).toDecimalPlaces(2);

  if (!billTotal.equals(amount)) {
    return {
      ok: false,
      error: `Items + fees − discounts = ${billTotal.toFixed(2)}, but the expense amount is ${amount.toFixed(2)}. Add an adjustment so they match.`,
    };
  }

  // ── Spread extras ────────────────────────────────────────────────────────
  const extras = feesTotal.minus(discountsTotal);
  const raw = new Map<string, Decimal>(itemShare);

  if (!extras.isZero()) {
    if (feePolicy === "payer") {
      if (!raw.has(payerId)) order.push(payerId);
      raw.set(payerId, (raw.get(payerId) ?? new Decimal(0)).plus(extras));
    } else if (feePolicy === "equal" || itemsTotal.isZero()) {
      const each = extras.div(order.length);
      for (const u of order) raw.set(u, raw.get(u)!.plus(each));
    } else {
      for (const u of order) raw.set(u, raw.get(u)!.plus(extras.mul(itemShare.get(u)!).div(itemsTotal)));
    }
  }

  for (const u of order) {
    if (raw.get(u)!.isNegative()) return { ok: false, error: "Discounts are larger than one person's items — check the discount amounts" };
  }

  // ── Largest-remainder rounding to the paisa ──────────────────────────────
  const totalPaise = amount.mul(100).toDecimalPlaces(0).toNumber();
  const floors = order.map((u) => {
    const paise = raw.get(u)!.mul(100);
    const floor = paise.floor();
    return { u, floor: floor.toNumber(), frac: paise.minus(floor).toNumber() };
  });
  let left = totalPaise - floors.reduce((a, f) => a + f.floor, 0);
  const byFrac = floors.map((f, i) => ({ i, frac: f.frac })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < byFrac.length; k++, left--) floors[byFrac[k].i].floor += 1;

  const shares = floors
    .filter((f) => f.floor > 0)
    .map((f) => ({ userId: f.u, shareAmount: new Decimal(f.floor).div(100).toDecimalPlaces(2) }));

  if (shares.length === 0) return { ok: false, error: "Nothing to split" };
  return { ok: true, shares };
}
