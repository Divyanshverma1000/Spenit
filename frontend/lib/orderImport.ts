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
  /** whole-order count as printed ("13 items in this order") */
  itemCount: number | null;
  items: { name: string; variant: string | null; qty: number; lineTotal: number; mrp: number | null }[];
  fees: { kind: string; label: string; amount: number }[];
  discounts: { label: string; amount: number }[];
  itemTotal: number | null;
  grandTotal: number | null;
  page: { hasHeader: boolean; hasTotal: boolean };
  confidence: "high" | "medium" | "low";
  /** short phrases the model was unsure of, e.g. "price of Ginger" */
  uncertain: string[];
}

export interface ExtractResponse {
  order: ExtractedOrder;
  totals: { status: string; difference: number | null; itemsMatchPrinted: boolean | null };
  model: string;
  latencyMs: number;
  attempts: number;
  usage: { promptTokens: number | null; completionTokens: number | null };
}

/** Why a screenshot could not be read — from the server, never a guess. */
export interface ExtractFailure {
  fallback: true;
  reason: string;
  stage: string;
  status?: number;
  message?: string;
  model?: string;
  /** Groq's retry-after, when it said it was busy */
  retryAfterMs?: number;
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
  /** the model said it was unsure of this row — highlight it */
  doubtful: boolean;
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

type Item = ExtractedOrder["items"][number];
const itemKey = (i: Item) => `${normName(i.name)}|${round2(i.lineTotal)}`;
const lineKey = (l: { label: string; amount: number }) => `${normName(l.label)}|${round2(l.amount)}`;

/**
 * Union of rows across screenshots of ONE order. A row seen in several screenshots
 * (overlap at a scroll boundary, Zepto's shipment tab repeating the overview) counts once;
 * a row printed twice in a single screenshot stays twice. Order: first appearance,
 * starting from the screenshot that shows the order's top.
 */
function unionRows<T>(lists: T[][], key: (t: T) => string): T[] {
  const best = new Map<string, number>();
  for (const list of lists) {
    const counts = new Map<string, number>();
    for (const t of list) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
    for (const [k, n] of counts) best.set(k, Math.max(best.get(k) ?? 0, n));
  }
  const out: T[] = [];
  const used = new Map<string, number>();
  for (const list of lists) {
    for (const t of list) {
      const k = key(t);
      if ((used.get(k) ?? 0) < (best.get(k) ?? 0)) {
        out.push(t);
        used.set(k, (used.get(k) ?? 0) + 1);
      }
    }
  }
  return out;
}

function mergeGroup(parts: Piece[]): ExtractedOrder {
  // top of the order first, the bill summary last, otherwise pick order
  const rank = (p: Piece) => (p.order.page.hasHeader ? 0 : p.order.page.hasTotal ? 2 : 1);
  const sorted = [...parts].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  const first = <T,>(f: (o: ExtractedOrder) => T | null) => {
    for (const p of sorted) { const v = f(p.order); if (v !== null) return v; }
    return null;
  };
  const orders = sorted.map((p) => p.order);
  const conf = orders.some((o) => o.confidence === "low") ? "low" : orders.some((o) => o.confidence === "medium") ? "medium" : "high";
  return {
    platform: orders.find((o) => o.platform !== "other")?.platform ?? "other",
    orderId: first((o) => o.orderId),
    orderDate: first((o) => o.orderDate),
    itemCount: first((o) => o.itemCount),
    items: unionRows(orders.map((o) => o.items), itemKey),
    fees: unionRows(orders.map((o) => o.fees), lineKey),
    discounts: unionRows(orders.map((o) => o.discounts), lineKey),
    itemTotal: first((o) => o.itemTotal),
    grandTotal: first((o) => o.grandTotal),
    page: { hasHeader: orders.some((o) => o.page.hasHeader), hasTotal: orders.some((o) => o.page.hasTotal) },
    confidence: conf,
    uncertain: Array.from(new Set(orders.flatMap((o) => o.uncertain))),
  };
}

/**
 * Group screenshots into orders, in ANY pick order:
 *   - same platform + order id → same order
 *   - otherwise two groups join when they share a product row (same name and price),
 *     e.g. the middle of a long Blinkit order overlaps both its top and its bottom.
 * Two groups never join if both have an order id that differs, both show a header
 * (two separate order tops), or both show a different grand total.
 */
export function joinPieces(pieces: Piece[]): { order: ExtractedOrder; sources: number[] }[] {
  type Group = { parts: Piece[]; key: string | null; headers: number; total: number | null; platform: Platform; items: Set<string> };
  const groups: Group[] = [];
  for (const p of [...pieces].sort((a, b) => a.index - b.index)) {
    const key = orderKey(p.order);
    const g: Group = {
      parts: [p], key, headers: p.order.page.hasHeader ? 1 : 0, total: p.order.grandTotal,
      platform: p.order.platform, items: new Set(p.order.items.map(itemKey)),
    };
    const same = key ? groups.find((x) => x.key === key) : undefined;
    if (same) absorb(same, g);
    else groups.push(g);
  }

  function compatible(a: Group, b: Group) {
    if (a.key && b.key && a.key !== b.key) return false;
    if (a.platform !== "other" && b.platform !== "other" && a.platform !== b.platform) return false;
    if (a.headers > 0 && b.headers > 0 && !(a.key && a.key === b.key)) return false;
    if (a.total !== null && b.total !== null && round2(a.total) !== round2(b.total)) return false;
    return true;
  }
  function absorb(into: Group, from: Group) {
    into.parts.push(...from.parts);
    into.key = into.key ?? from.key;
    into.headers += from.headers;
    into.total = into.total ?? from.total;
    if (into.platform === "other") into.platform = from.platform;
    from.items.forEach((k) => into.items.add(k));
  }

  // Keep merging overlapping groups until nothing changes.
  for (let changed = true; changed; ) {
    changed = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        const overlap = [...b.items].some((k) => a.items.has(k));
        if (overlap && compatible(a, b)) {
          absorb(a, b);
          groups.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  return groups
    .map((g) => ({ order: mergeGroup(g.parts), sources: g.parts.map((p) => p.index).sort((a, b) => a - b) }))
    .sort((a, b) => a.sources[0] - b.sources[0]);
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

/**
 * Does the "N items" heading match what we found? Apps count differently: Blinkit and
 * Zepto count rows, Instamart counts units (3 x Maggi = 3), so either may match.
 * null when no count was printed.
 */
export function itemCountCheck(o: Pick<ExtractedOrder, "itemCount" | "items">): { printed: number; ok: boolean } | null {
  if (o.itemCount === null) return null;
  const units = Math.round(o.items.reduce((a, i) => a + i.qty, 0));
  return { printed: o.itemCount, ok: o.items.length === o.itemCount || units === o.itemCount };
}

/** An order can be saved once its totals add up, or the user accepted the items total. */
export function isReady(o: DraftOrder): boolean {
  if (o.skipped) return true;
  const t = draftTotals(o);
  if (t.status === "no_items") return false;
  if (t.computed <= 0) return false;
  if (o.items.some((i) => i.sharedBy.length === 0 || !i.name.trim())) return false;
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
      doubtful: order.uncertain.some((u) => normName(u).includes(normName(i.name).split(" ").slice(0, 2).join(" "))),
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
      fees: o.fees.filter((f) => f.amount > 0).map((f) => ({ label: f.label.trim() || "Fee", amount: f.amount })),
      discounts: o.discounts.map((d) => ({ label: d.label, amount: d.amount })),
      feePolicy: o.feePolicy,
    },
  };
}

export const formatINR = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
