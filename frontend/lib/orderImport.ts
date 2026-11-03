/**
 * Bulk order import — client-side logic (BulkOrderSplit_Plan.md §3.2, §3.3, §4).
 *
 * Pure functions only:
 *   - joinPieces:     screenshots of the same order (top half / bottom half) → one order
 *   - draftTotals:    does this order add up to its bill total?
 *   - previewShares:  who owes what — a PREVIEW; the server computes the real shares
 */

export type Platform =
  | "blinkit" | "zepto" | "instamart" | "bigbasket" | "swiggy" | "zomato"
  | "amazon" | "flipkart" | "jiomart" | "dmart" | "other";

export type FeePolicy = "proportional" | "equal" | "payer";

/** What /ai/extract-order returns for one screenshot (mirrors backend lib/orderExtract). */
export interface ExtractedOrder {
  platform: Platform;
  orderId: string | null;
  orderDate: string | null;
  items: { name: string; variant: string | null; qty: number; unitPrice: number | null; lineTotal: number; grounded: boolean }[];
  fees: { kind: string; label: string; amount: number; grounded: boolean }[];
  discounts: { label: string; amount: number; grounded: boolean }[];
  grandTotal: number | null;
  grandTotalGrounded: boolean;
  page: { hasHeader: boolean; hasTotal: boolean };
}

export interface ExtractResponse {
  order: ExtractedOrder;
  totals: { status: string; difference: number | null };
  groundedShare: number;
  needsVision: boolean;
  source: "text" | "vision";
  model: string;
  latencyMs: number;
}

/** One picked screenshot and its extraction. `index` = pick order, used for joining. */
export interface Piece {
  index: number;
  order: ExtractedOrder;
}

export interface DraftItem {
  id: string;
  name: string;
  variant: string | null;
  qty: number;
  lineTotal: number;
  sharedBy: string[];
  grounded: boolean;
}

export interface DraftLine {
  id: string;
  label: string;
  amount: number;
}

export interface DraftOrder {
  id: string;
  platform: Platform;
  orderId: string | null;
  orderDate: string | null;
  items: DraftItem[];
  fees: DraftLine[];
  discounts: DraftLine[];
  grandTotal: number | null;
  payerId: string;
  feePolicy: FeePolicy;
  skipped: boolean;
  /** user chose to go with the items total even though it doesn't match the bill */
  acceptItemsTotal: boolean;
  /** pick indexes of the screenshots this order came from */
  sources: number[];
  alreadyAdded: { expenseId: string; createdAt: string } | null;
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  blinkit: "Blinkit", zepto: "Zepto", instamart: "Instamart", bigbasket: "BigBasket",
  swiggy: "Swiggy", zomato: "Zomato", amazon: "Amazon", flipkart: "Flipkart",
  jiomart: "JioMart", dmart: "DMart", other: "Order",
};

export const TOTALS_TOLERANCE = 1;
const round2 = (n: number) => Math.round(n * 100) / 100;
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normId = (s: string | null) => (s ? s.toUpperCase().replace(/[^A-Z0-9]/g, "") : null);

export function orderKey(o: { platform: Platform; orderId: string | null }): string | null {
  const id = normId(o.orderId);
  return id ? `${o.platform}:${id}` : null;
}

// ── Joining screenshots of one order ───────────────────────────────────────────

function sameItem(a: ExtractedOrder["items"][number], b: ExtractedOrder["items"][number]) {
  return normName(a.name) === normName(b.name) && round2(a.lineTotal) === round2(b.lineTotal);
}

function merge(a: ExtractedOrder, b: ExtractedOrder): ExtractedOrder {
  // Long orders overlap at the screenshot boundary: drop B's leading items that repeat A's tail.
  const tail = a.items.slice(-4);
  let skip = 0;
  while (skip < Math.min(4, b.items.length) && tail.some((t) => sameItem(t, b.items[skip]))) skip++;

  const lineKey = (l: { label: string; amount: number }) => `${normName(l.label)}:${l.amount}`;
  const union = <T extends { label: string; amount: number }>(x: T[], y: T[]) => {
    const seen = new Set(x.map(lineKey));
    return [...x, ...y.filter((l) => !seen.has(lineKey(l)))];
  };

  return {
    platform: a.platform !== "other" ? a.platform : b.platform,
    orderId: a.orderId ?? b.orderId,
    orderDate: a.orderDate ?? b.orderDate,
    items: [...a.items, ...b.items.slice(skip)],
    fees: union(a.fees, b.fees),
    discounts: union(a.discounts, b.discounts),
    grandTotal: a.grandTotal ?? b.grandTotal,
    grandTotalGrounded: a.grandTotal !== null ? a.grandTotalGrounded : b.grandTotalGrounded,
    page: { hasHeader: a.page.hasHeader || b.page.hasHeader, hasTotal: a.page.hasTotal || b.page.hasTotal },
  };
}

/**
 * Join pieces (in pick order) into orders.
 *   - same platform + order id → same order, wherever it was picked
 *   - a piece with no header and no id continues the previous order if that one had no total yet
 */
export function joinPieces(pieces: Piece[]): { order: ExtractedOrder; sources: number[] }[] {
  const out: { order: ExtractedOrder; sources: number[] }[] = [];
  for (const p of [...pieces].sort((a, b) => a.index - b.index)) {
    const key = orderKey(p.order);
    let target = key ? out.find((o) => orderKey(o.order) === key) : undefined;

    if (!target && !key && !p.order.page.hasHeader && out.length > 0) {
      const prev = out[out.length - 1];
      const samePlatform = p.order.platform === "other" || prev.order.platform === "other" || p.order.platform === prev.order.platform;
      if (samePlatform && !prev.order.page.hasTotal) target = prev;
    }
    // A header-only piece (id, no total) followed by the rest with the same id is handled above;
    // a piece with an id joining a previous id-less top half:
    if (!target && key && out.length > 0) {
      const prev = out[out.length - 1];
      if (!orderKey(prev.order) && !prev.order.page.hasTotal && !p.order.page.hasHeader && prev.order.platform === p.order.platform) target = prev;
    }

    if (target) {
      target.order = merge(target.order, p.order);
      target.sources.push(p.index);
    } else {
      out.push({ order: structuredClone(p.order), sources: [p.index] });
    }
  }
  return out;
}

// ── Totals ─────────────────────────────────────────────────────────────────────

export type DraftTotalsStatus = "ok" | "mismatch" | "no_total" | "no_items";

export function draftTotals(o: {
  items: { lineTotal: number }[];
  fees: { amount: number }[];
  discounts: { amount: number }[];
  grandTotal: number | null;
}) {
  const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
  const itemsTotal = sum(o.items.map((i) => i.lineTotal));
  const feesTotal = sum(o.fees.map((f) => f.amount));
  const discountsTotal = sum(o.discounts.map((d) => d.amount));
  const computed = round2(itemsTotal + feesTotal - discountsTotal);
  let status: DraftTotalsStatus;
  let difference: number | null = null;
  if (o.items.length === 0) status = "no_items";
  else if (o.grandTotal === null) status = "no_total";
  else {
    difference = round2(o.grandTotal - computed);
    status = Math.abs(difference) <= TOTALS_TOLERANCE ? "ok" : "mismatch";
  }
  return { itemsTotal, feesTotal, discountsTotal, computed, difference, status };
}

/** An order can be saved once its totals add up, or the user accepted the items total. */
export function isReady(o: DraftOrder): boolean {
  if (o.skipped) return true;
  const t = draftTotals(o);
  if (t.status === "no_items") return false;
  if (t.computed <= 0) return false;
  if (o.items.some((i) => i.sharedBy.length === 0)) return false;
  return t.status === "ok" || t.status === "no_total" || o.acceptItemsTotal;
}

// ── Share preview (server is the authority; this mirrors backend lib/itemizedSplit) ──

export function previewShares(o: DraftOrder): Record<string, number> {
  const itemShare: Record<string, number> = {};
  for (const it of o.items) {
    if (it.sharedBy.length === 0) continue;
    for (const u of it.sharedBy) itemShare[u] = (itemShare[u] ?? 0) + it.lineTotal / it.sharedBy.length;
  }
  const t = draftTotals(o);
  const extras = t.feesTotal - t.discountsTotal;
  const people = Object.keys(itemShare);
  const out: Record<string, number> = { ...itemShare };
  if (extras !== 0 && people.length > 0) {
    if (o.feePolicy === "payer") out[o.payerId] = (out[o.payerId] ?? 0) + extras;
    else if (o.feePolicy === "equal" || t.itemsTotal === 0) for (const u of people) out[u] += extras / people.length;
    else for (const u of people) out[u] += (extras * itemShare[u]) / t.itemsTotal;
  }
  for (const u of Object.keys(out)) out[u] = round2(out[u]);
  return out;
}

/**
 * Net result of the whole import for `me`: + means they owe me, − means I owe them.
 * Also returns what I spent on my own items.
 */
export function netForMe(orders: DraftOrder[], me: string) {
  const net: Record<string, number> = {};
  let mine = 0;
  for (const o of orders) {
    if (o.skipped) continue;
    const shares = previewShares(o);
    mine += shares[me] ?? 0;
    for (const [u, amt] of Object.entries(shares)) {
      if (u === o.payerId) continue;
      if (o.payerId === me) net[u] = (net[u] ?? 0) + amt;
      else if (u === me) net[o.payerId] = (net[o.payerId] ?? 0) - amt;
    }
  }
  for (const u of Object.keys(net)) net[u] = round2(net[u]);
  return { net, mine: round2(mine) };
}

// ── Building drafts and request bodies ─────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 10);

export function toDraft(order: ExtractedOrder, sources: number[], me: string, everyone: string[]): DraftOrder {
  return {
    id: uid(),
    platform: order.platform,
    orderId: order.orderId,
    orderDate: order.orderDate,
    items: order.items.map((i) => ({
      id: uid(),
      name: i.name,
      variant: i.variant,
      qty: i.qty,
      lineTotal: i.lineTotal,
      sharedBy: [...everyone],
      grounded: i.grounded,
    })),
    fees: order.fees.map((f) => ({ id: uid(), label: f.label, amount: f.amount })),
    discounts: order.discounts.map((d) => ({ id: uid(), label: d.label, amount: d.amount })),
    grandTotal: order.grandTotal,
    payerId: me,
    feePolicy: "proportional",
    skipped: false,
    acceptItemsTotal: false,
    sources,
    alreadyAdded: null,
  };
}

/** Put the difference to the bill total on a visible "Adjustment" line. */
export function adjustToBillTotal(o: DraftOrder): DraftOrder {
  const t = draftTotals(o);
  if (t.difference === null || t.difference === 0) return o;
  const line = { id: uid(), label: "Adjustment (to match bill)", amount: Math.abs(t.difference) };
  return t.difference > 0
    ? { ...o, fees: [...o.fees, line], acceptItemsTotal: false }
    : { ...o, discounts: [...o.discounts, line], acceptItemsTotal: false };
}

export function orderTitle(o: Pick<DraftOrder, "platform" | "orderDate">): string {
  const date = o.orderDate
    ? new Date(o.orderDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : null;
  return date ? `${PLATFORM_LABEL[o.platform]} · ${date}` : PLATFORM_LABEL[o.platform];
}

export function toExpenseBody(o: DraftOrder) {
  const t = draftTotals(o);
  return {
    description: `${orderTitle(o)} order`,
    amount: t.computed,
    currency: "INR",
    splitType: "itemized" as const,
    category: o.platform === "swiggy" || o.platform === "zomato" ? "Food" : "Shopping",
    payers: [{ userId: o.payerId, amountPaid: t.computed }],
    participants: [],
    receiptData: {
      source: "order_import",
      platform: o.platform,
      orderId: o.orderId,
      orderKey: orderKey(o),
      orderDate: o.orderDate,
      billTotal: o.grandTotal,
      items: o.items.map((i) => ({ name: i.name, variant: i.variant, qty: i.qty, lineTotal: i.lineTotal, sharedBy: i.sharedBy })),
      fees: o.fees.map((f) => ({ label: f.label, amount: f.amount })),
      discounts: o.discounts.map((d) => ({ label: d.label, amount: d.amount })),
      feePolicy: o.feePolicy,
    },
  };
}

export const formatINR = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
