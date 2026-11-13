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
export type SpendKind = "order" | "receipt" | "payment";

export interface ExtractedOrder {
  /** an app order, a photo of a printed bill, or one payment / booking with no items */
  kind?: SpendKind;
  merchant?: string | null;
  /** payments: who the money went to */
  payee?: string | null;
  payApp?: string | null;
  category?: string | null;
  platform: Platform;
  orderId: string | null;
  orderDate: string | null;
  /** whole-order count as printed ("13 items in this order") */
  itemCount: number | null;
  items: { name: string; short?: string | null; variant: string | null; qty: number; lineTotal: number; mrp: number | null }[];
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
  /** busy because of Groq's daily cap, not the per-minute one */
  perDay?: boolean;
  /** how many of the person's Groq keys were tried */
  keys?: number;
}

/** One picked screenshot and its extraction. `index` = pick order, used for joining. */
export interface Piece {
  index: number;
  order: ExtractedOrder;
}

export interface DraftItem {
  id: string;
  name: string;
  /** what it is in a word or two, from the model; cleared when the name is edited */
  short?: string | null;
  variant: string | null;
  qty: number;
  lineTotal: number;
  sharedBy: string[];
  /** the model said it was unsure of this row — highlight it */
  doubtful: boolean;
  /** a one-person item its owner chose to show the group (kept when a bill is edited) */
  visible?: boolean;
}

export interface DraftLine {
  id: string;
  label: string;
  amount: number;
}

export interface DraftOrder {
  id: string;
  kind?: SpendKind;
  merchant?: string | null;
  payee?: string | null;
  payApp?: string | null;
  category?: string | null;
  /** a payment to someone in the group: save it as a settle-up to them, not as a bill */
  settleWith?: string | null;
  /** the group member the payee looks like, if any (offered as "paying them back") */
  payeeMember?: string | null;
  /** a name the user typed for this order; empty = "Blinkit · 5 Nov order" */
  title?: string;
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
  /** the "N items" the app printed on the order, if the AI saw it */
  itemCount?: number | null;
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
    kind: orders.some((o) => (o.kind ?? "order") === "order") ? "order" : orders.some((o) => o.kind === "receipt") ? "receipt" : "payment",
    merchant: first((o) => o.merchant ?? null),
    payee: first((o) => o.payee ?? null),
    payApp: first((o) => o.payApp ?? null),
    category: first((o) => o.category ?? null),
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
  if (o.settleWith) return (o.grandTotal ?? draftTotals(o).computed) > 0;
  const t = draftTotals(o);
  if (t.status === "no_items") return false;
  if (t.computed <= 0) return false;
  if (o.items.some((i) => i.sharedBy.length === 0 || !i.name.trim())) return false;
  return t.status === "ok" || t.status === "no_total" || o.acceptItemsTotal;
}

// ── How a card looks while sorting ─────────────────────────────────────────────

/**
 * ok        adds up to the bill (green)
 * accepted  doesn't match, but the person chose the items total (green, says so)
 * short     items come to less than the bill (needs a look)
 * over      items come to more than the bill (needs a look)
 * unknown   no bill total was read, so it can't be checked (blue)
 * skipped / empty
 */
export type CardState = "ok" | "accepted" | "short" | "over" | "unknown" | "skipped" | "empty";

export function cardState(o: DraftOrder): CardState {
  if (o.skipped) return "skipped";
  const t = draftTotals(o);
  if (t.status === "no_items") return "empty";
  if (t.status === "ok") return "ok";
  if (t.status === "no_total") return "unknown";
  if (o.acceptItemsTotal) return "accepted";
  return (t.difference ?? 0) > 0 ? "short" : "over";
}

/** The likely reasons a card doesn't add up, most likely first, in plain words. */
export function mismatchReasons(o: DraftOrder, canJoin: boolean): string[] {
  const state = cardState(o);
  const out: string[] = [];
  const found = o.items.length;
  const units = Math.round(o.items.reduce((a, i) => a + i.qty, 0));
  const printed = o.itemCount ?? null;
  const doubtful = o.items.filter((i) => i.doubtful).length;
  if (state === "short") {
    if (printed !== null && found < printed && units < printed)
      out.push(`The order says ${printed} items but ${found} were read. Some may be cut off between screenshots.`);
    if (canJoin) out.push("The rest of this order may be on another card. Join them with \"Same order as…\".");
    else out.push("Part of the order may be on a screenshot you didn't add.");
    out.push("A delivery fee, tip, tax or packing charge may not have been read.");
  } else if (state === "over") {
    out.push("A discount, coupon or cashback may not have been read.");
    if (o.sources.length > 1) out.push("Screenshots may overlap, so an item was counted twice.");
    if (printed !== null && found > printed && units > printed)
      out.push(`The order says ${printed} items but ${found} were read. One may be extra.`);
  } else {
    return out;
  }
  out.push(doubtful > 0
    ? `${doubtful === 1 ? "A price" : `${doubtful} prices`} the AI wasn't sure of ${doubtful === 1 ? "is" : "are"} marked below. Check ${doubtful === 1 ? "it" : "them"} against the screenshot.`
    : "A price may have been misread. Compare with the screenshot.");
  return out;
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

/** The group member a payee name points to ("Suryansh Kumar" → Suryansh), never yourself. */
export function matchMember(payee: string | null | undefined, members: { id: string; name: string }[], me: string): string | null {
  if (!payee) return null;
  const words = (x: string) => normName(x).split(" ").filter((w) => w.length >= 3);
  const p = words(payee);
  if (p.length === 0) return null;
  const hits = members.filter((m) => m.id !== me && words(m.name).some((w) => p.includes(w)));
  return hits.length === 1 ? hits[0].id : null;
}

export function toDraft(
  order: ExtractedOrder, sources: number[], me: string, everyone: string[], members: { id: string; name: string }[] = []
): DraftOrder {
  const kind: SpendKind = order.kind ?? (order.items.length === 0 && order.grandTotal !== null ? "payment" : "order");
  // A payment has no item list: it becomes one line, shared by everyone until changed.
  const items = kind === "payment" && order.items.length === 0 && order.grandTotal
    ? [{ name: order.payee || order.merchant || "Payment", short: null, variant: null, qty: 1, lineTotal: order.grandTotal, mrp: null }]
    : order.items;
  const payeeMember = kind === "payment" ? matchMember(order.payee, members, me) : null;
  return {
    id: uid(),
    kind,
    merchant: order.merchant ?? null,
    payee: order.payee ?? null,
    payApp: order.payApp ?? null,
    category: order.category ?? null,
    payeeMember,
    // Money sent to someone in the group is most likely paying them back.
    settleWith: payeeMember,
    platform: order.platform,
    orderId: order.orderId,
    orderDate: order.orderDate,
    items: items.map((i) => ({
      id: uid(),
      name: i.name,
      short: i.short ?? null,
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
    itemCount: order.itemCount ?? null,
    alreadyAdded: null,
  };
}

/**
 * "Same order as…": the user joins two cards by hand, e.g. when the middle screenshot of a
 * long order is missing so nothing overlaps. Rows already in `into` (same name and price)
 * are not added twice; people already chosen on `into` are kept.
 */
export function mergeDrafts(into: DraftOrder, from: DraftOrder): DraftOrder {
  const key = (i: { name: string; lineTotal: number }) => `${normName(i.name)}|${round2(i.lineTotal)}`;
  const have = new Set(into.items.map(key));
  const line = (l: DraftLine) => `${normName(l.label)}|${round2(l.amount)}`;
  const addLines = (a: DraftLine[], b: DraftLine[]) => {
    const seen = new Set(a.map(line));
    return [...a, ...b.filter((l) => !seen.has(line(l)))];
  };
  return {
    ...into,
    platform: into.platform !== "other" ? into.platform : from.platform,
    orderId: into.orderId ?? from.orderId,
    orderDate: into.orderDate ?? from.orderDate,
    items: [...into.items, ...from.items.filter((i) => !have.has(key(i)))],
    fees: addLines(into.fees, from.fees),
    discounts: addLines(into.discounts, from.discounts),
    grandTotal: into.grandTotal ?? from.grandTotal,
    skipped: false,
    acceptItemsTotal: false,
    sources: [...into.sources, ...from.sources].sort((a, b) => a - b),
    itemCount: into.itemCount ?? from.itemCount ?? null,
    alreadyAdded: into.alreadyAdded ?? from.alreadyAdded,
  };
}

/**
 * Does this card look like only part of an order? Then "Same order as…" is offered prominently.
 * (A full order adds up to its bill; a part has no bill, or its items fall short of it.)
 */
export function looksPartial(o: DraftOrder): boolean {
  const t = draftTotals(o);
  return t.status === "no_total" || (t.status === "mismatch" && (t.difference ?? 0) > 0);
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

/**
 * Turn a saved imported order back into a draft, to edit it in the same item editor.
 * Null when it isn't an imported order, or when some items are hidden from this viewer
 * (someone else's private items) — those can only be edited by the person who added it.
 */
export function draftFromExpense(e: {
  description?: string;
  category?: string | null;
  amount: string | number;
  receiptData?: unknown;
  payers: { userId: string }[];
}): DraftOrder | null {
  const r = e.receiptData as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || Array.isArray(r) || !Array.isArray(r.items) || r.items.length === 0) return null;
  const items = r.items as Record<string, unknown>[];
  if (items.some((i) => i?.masked)) return null;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const lines = (v: unknown) =>
    (Array.isArray(v) ? (v as Record<string, unknown>[]) : []).map((x) => ({ id: uid(), label: String(x.label ?? ""), amount: n(x.amount) }));
  const platform = typeof r.platform === "string" && r.platform in PLATFORM_LABEL ? (r.platform as Platform) : "other";
  const billTotal = r.billTotal === null || r.billTotal === undefined ? null : n(r.billTotal);
  const kind = r.kind === "receipt" || r.kind === "payment" ? r.kind : "order";
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    id: uid(),
    title: e.description ?? "",
    kind,
    merchant: text(r.merchant),
    payee: text(r.payee),
    payApp: text(r.payApp),
    category: e.category ?? null, // editing keeps the bill's category
    platform,
    orderId: typeof r.orderId === "string" ? r.orderId : null,
    orderDate: typeof r.orderDate === "string" ? r.orderDate : null,
    items: items.map((i) => ({
      id: uid(),
      name: String(i.name ?? ""),
      short: typeof i.short === "string" ? i.short : null,
      variant: typeof i.variant === "string" ? i.variant : null,
      qty: n(i.qty) || 1,
      lineTotal: n(i.lineTotal),
      sharedBy: Array.isArray(i.sharedBy) ? (i.sharedBy as string[]) : [],
      doubtful: false,
      visible: i.visible === true,
    })),
    fees: lines(r.fees),
    discounts: lines(r.discounts),
    grandTotal: billTotal,
    payerId: e.payers[0]?.userId ?? "",
    feePolicy: r.feePolicy === "equal" || r.feePolicy === "payer" ? r.feePolicy : "proportional",
    skipped: false,
    acceptItemsTotal: billTotal === null,
    sources: [],
    alreadyAdded: null,
  };
}

export function orderTitle(o: Pick<DraftOrder, "platform" | "orderDate"> & { kind?: SpendKind; merchant?: string | null; payee?: string | null }): string {
  const date = o.orderDate
    ? new Date(o.orderDate + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })
    : null;
  const name =
    o.platform !== "other" ? PLATFORM_LABEL[o.platform]
    : o.merchant || o.payee || (o.kind === "payment" ? "Payment" : o.kind === "receipt" ? "Bill" : PLATFORM_LABEL.other);
  return date ? `${name} · ${date}` : name;
}

export function toExpenseBody(o: DraftOrder) {
  const t = draftTotals(o);
  return {
    description: o.title?.trim() || ((o.kind ?? "order") === "order" ? `${orderTitle(o)} order` : orderTitle(o)),
    amount: t.computed,
    currency: "INR",
    splitType: "itemized" as const,
    category:
      o.platform === "swiggy" || o.platform === "zomato" ? "Food"
      : o.platform === "amazon" || o.platform === "flipkart" ? "Shopping"
      : o.platform !== "other" ? "Groceries" // Blinkit, Zepto, Instamart, BigBasket, JioMart, DMart
      : o.category || "Misc", // printed bills and payments: what the reader saw
    payers: [{ userId: o.payerId, amountPaid: t.computed }],
    participants: [],
    receiptData: {
      source: "order_import",
      kind: o.kind ?? "order",
      ...(o.merchant ? { merchant: o.merchant } : {}),
      ...(o.payee ? { payee: o.payee } : {}),
      ...(o.payApp ? { payApp: o.payApp } : {}),
      platform: o.platform,
      orderId: o.orderId,
      orderKey: orderKey(o),
      orderDate: o.orderDate,
      billTotal: o.grandTotal,
      items: o.items.map((i) => ({ name: i.name, ...(i.short ? { short: i.short } : {}), ...(i.visible ? { visible: true } : {}), variant: i.variant, qty: i.qty, lineTotal: i.lineTotal, sharedBy: i.sharedBy })),
      fees: o.fees.filter((f) => f.amount > 0).map((f) => ({ label: f.label.trim() || "Fee", amount: f.amount })),
      discounts: o.discounts.map((d) => ({ label: d.label, amount: d.amount })),
      feePolicy: o.feePolicy,
    },
  };
}

export const formatINR = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
