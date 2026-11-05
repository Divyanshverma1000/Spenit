/**
 * orderExtract.ts — plain-code checks around AI order extraction (BulkOrderSplit_Plan.md §3).
 *
 * The vision model reads ONE screenshot. Everything that decides whether we trust the
 * result lives here, in code:
 *
 *   - normalizeOrder:  coerce whatever JSON the model returned into a strict ExtractedOrder
 *                      (keeps every usable row; a bad row is dropped, never the whole order)
 *   - checkTotals:     Σ items + Σ fees − Σ discounts must equal the printed grand total,
 *                      and Σ items should equal the printed item total
 *
 * Joining screenshots of one order happens on the phone (frontend/lib/orderImport.ts):
 * a single screenshot may show only one shipment or one part of a long order, so a
 * per-screenshot mismatch is expected and informational.
 *
 * No I/O, no AI calls — unit tested in orderExtract.test.ts.
 */

export const ORDER_PLATFORMS = [
  "blinkit", "zepto", "instamart", "bigbasket", "swiggy", "zomato", "amazon", "flipkart", "jiomart", "dmart", "other",
] as const;
export type OrderPlatform = (typeof ORDER_PLATFORMS)[number];

export const FEE_KINDS = [
  "delivery", "handling", "platform", "small_cart", "packaging", "tip", "late_night", "surge", "tax", "other",
] as const;
export type FeeKind = (typeof FEE_KINDS)[number];

export interface ExtractedItem {
  name: string;
  /** what it is in a word or two ("milk", "chips") — for bill summaries */
  short: string | null;
  variant: string | null;
  qty: number;
  lineTotal: number;
  /** crossed-out price, when shown */
  mrp: number | null;
}

export interface ExtractedFee {
  kind: FeeKind;
  label: string;
  amount: number;
}

export interface ExtractedDiscount {
  label: string;
  amount: number; // positive number that is SUBTRACTED
}

export type TotalsStatus = "ok" | "mismatch" | "no_total" | "no_items";

export interface TotalsCheck {
  status: TotalsStatus;
  itemsTotal: number;
  feesTotal: number;
  discountsTotal: number;
  computedTotal: number;
  /** grandTotal − computedTotal; positive = the bill is MORE than what we found */
  difference: number | null;
  /** Σ items vs the printed item total: null when no item total was printed */
  itemsMatchPrinted: boolean | null;
}

export interface ExtractedOrder {
  platform: OrderPlatform;
  orderId: string | null;
  orderDate: string | null; // YYYY-MM-DD
  /** "13 items in this order" — whole-order count as printed */
  itemCount: number | null;
  items: ExtractedItem[];
  fees: ExtractedFee[];
  discounts: ExtractedDiscount[];
  itemTotal: number | null;
  grandTotal: number | null;
  /** which part of an order this screenshot shows — used to join pieces on the phone */
  page: { hasHeader: boolean; hasTotal: boolean };
  confidence: "high" | "medium" | "low";
  uncertain: string[];
}

/** Rounding slack for the totals check (Instamart prints ₹209.01 as a ₹209 grand total). */
export const TOTALS_TOLERANCE = 1;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "₹1,284.00" | "1284" | 1284 → 1284. Anything unusable → null. */
export function toMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? round2(Math.abs(v)) : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return round2(Math.abs(parseFloat(cleaned)));
}

function str(v: unknown, max = 120): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.toLowerCase() !== "null" ? t.slice(0, max) : null;
}

function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

/** "ORDER #249970716902473" / "#UHISJNSOQ27227" → bare id. */
function cleanOrderId(v: unknown): string | null {
  const s = str(v, 60);
  if (!s) return null;
  const id = s.replace(/^(order\s*(id)?\s*[:#]?\s*)/i, "").replace(/^#/, "").trim();
  return id.length >= 4 ? id : null;
}

/** Coerce the model's JSON into an ExtractedOrder. Rows without a usable name or price are dropped. */
export function normalizeOrder(raw: any): ExtractedOrder {
  const platform = String(raw?.platform || "").toLowerCase() as OrderPlatform;

  const items: ExtractedItem[] = [];
  for (const it of Array.isArray(raw?.items) ? raw.items : []) {
    const name = str(it?.name);
    const qtyNum = Number(it?.qty);
    const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? Math.round(qtyNum * 1000) / 1000 : 1;
    const lineTotal = toMoney(it?.lineTotal);
    if (!name || lineTotal === null) continue;
    const mrp = toMoney(it?.mrp);
    const short = str(it?.short)?.toLowerCase().slice(0, 24) ?? null;
    items.push({ name, short, variant: str(it?.variant), qty, lineTotal, mrp: mrp !== null && mrp > lineTotal ? mrp : null });
  }

  const fees: ExtractedFee[] = [];
  for (const f of Array.isArray(raw?.fees) ? raw.fees : []) {
    const amount = toMoney(f?.amount);
    if (amount === null || amount === 0) continue; // "Free delivery ₹0" changes nothing
    const kind = String(f?.kind || "").toLowerCase() as FeeKind;
    fees.push({ kind: (FEE_KINDS as readonly string[]).includes(kind) ? kind : "other", label: str(f?.label) || "Fee", amount });
  }

  const discounts: ExtractedDiscount[] = [];
  for (const d of Array.isArray(raw?.discounts) ? raw.discounts : []) {
    const amount = toMoney(d?.amount);
    if (amount === null || amount === 0) continue;
    const label = str(d?.label) || "Discount";
    // Already inside the item prices (Blinkit "Product discount"); subtracting it again is wrong.
    if (/product discount|mrp discount|you saved|savings/i.test(label)) continue;
    discounts.push({ label, amount });
  }

  const count = Number(raw?.itemCount);
  const confidence = ["high", "medium", "low"].includes(raw?.confidence) ? raw.confidence : "medium";
  const grandTotal = toMoney(raw?.grandTotal);

  return {
    platform: (ORDER_PLATFORMS as readonly string[]).includes(platform) ? platform : "other",
    orderId: cleanOrderId(raw?.orderId),
    orderDate: isoDate(raw?.orderDate),
    itemCount: Number.isInteger(count) && count > 0 ? count : null,
    items,
    fees,
    discounts,
    itemTotal: toMoney(raw?.itemTotal),
    grandTotal,
    page: {
      hasHeader: Boolean(raw?.page?.hasHeader),
      hasTotal: Boolean(raw?.page?.hasTotal) || grandTotal !== null,
    },
    confidence,
    uncertain: (Array.isArray(raw?.uncertain) ? raw.uncertain : [])
      .map((u: unknown) => str(u, 80))
      .filter((u: string | null): u is string => !!u)
      .slice(0, 10),
  };
}

export function checkTotals(
  order: Pick<ExtractedOrder, "items" | "fees" | "discounts" | "grandTotal" | "itemTotal">
): TotalsCheck {
  const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
  const itemsTotal = sum(order.items.map((i) => i.lineTotal));
  const feesTotal = sum(order.fees.map((f) => f.amount));
  const discountsTotal = sum(order.discounts.map((d) => d.amount));
  const computedTotal = round2(itemsTotal + feesTotal - discountsTotal);
  const itemsMatchPrinted =
    order.itemTotal === null ? null : Math.abs(order.itemTotal - itemsTotal) <= TOTALS_TOLERANCE;

  const base = { itemsTotal, feesTotal, discountsTotal, computedTotal, itemsMatchPrinted };
  if (order.items.length === 0) return { status: "no_items", ...base, difference: null };
  if (order.grandTotal === null) return { status: "no_total", ...base, difference: null };
  const difference = round2(order.grandTotal - computedTotal);
  return { status: Math.abs(difference) <= TOTALS_TOLERANCE ? "ok" : "mismatch", ...base, difference };
}
