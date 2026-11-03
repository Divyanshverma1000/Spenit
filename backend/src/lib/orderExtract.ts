/**
 * orderExtract.ts — plain-code checks around AI order extraction (BulkOrderSplit_Plan.md §3).
 *
 * The phone runs OCR and sends us TEXT. The AI only turns that text into structure.
 * Everything that decides whether we trust the result lives here, in code:
 *
 *   - normalizeOrder:  coerce whatever JSON the model returned into a strict ExtractedOrder
 *   - groundOrder:     every money value the AI returned must appear in the OCR text.
 *                      A value that doesn't is flagged — the AI can't invent digits silently.
 *   - checkTotals:     Σ items + Σ fees − Σ discounts must equal the printed grand total
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
  variant: string | null;
  qty: number;
  unitPrice: number | null;
  lineTotal: number;
  /** false when lineTotal could not be found anywhere in the OCR text */
  grounded: boolean;
}

export interface ExtractedFee {
  kind: FeeKind;
  label: string;
  amount: number;
  grounded: boolean;
}

export interface ExtractedDiscount {
  label: string;
  amount: number; // positive number that is SUBTRACTED
  grounded: boolean;
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
}

export interface ExtractedOrder {
  platform: OrderPlatform;
  orderId: string | null;
  orderDate: string | null; // YYYY-MM-DD
  items: ExtractedItem[];
  fees: ExtractedFee[];
  discounts: ExtractedDiscount[];
  grandTotal: number | null;
  grandTotalGrounded: boolean;
  /** which part of an order this screenshot shows — used to join pieces on the phone */
  page: { hasHeader: boolean; hasTotal: boolean };
}

/** Rounding slack for the totals check (apps round to the rupee in places). */
export const TOTALS_TOLERANCE = 1;

// ── Number helpers ─────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "₹1,284.00" | "1284" | 1284 → 1284. Anything unusable → null. */
export function toMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? round2(Math.abs(v)) : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return round2(Math.abs(parseFloat(cleaned)));
}

/**
 * Every number printed in the OCR text, as money values.
 *
 * Tesseract often reads the rupee sign as a digit or symbol glued to the price:
 * "₹54" → "254", "%54", "R54", "354", "754". So for every token we also accept the value
 * with a leading 2/3/7 dropped. The totals check catches the rare wrong pick.
 */
export function numbersInText(text: string): Set<number> {
  const found = new Set<number>();
  const tokens = text.match(/\d[\d,]*(?:\.\d{1,2})?/g) || [];
  for (const raw of tokens) {
    const plain = raw.replace(/,/g, "");
    const add = (s: string) => {
      if (!s) return;
      const n = parseFloat(s);
      if (Number.isFinite(n)) found.add(round2(n));
    };
    add(plain);
    if (/^[237]\d/.test(plain)) add(plain.slice(1));
    // "54.00" printed as "5400" when OCR drops the dot
    if (/^\d{3,}00$/.test(plain)) add(plain.slice(0, -2));
  }
  return found;
}

function grounded(value: number, numbers: Set<number>): boolean {
  if (value === 0) return true; // "FREE", "₹0" — nothing to invent
  return numbers.has(round2(value));
}

// ── Normalize ──────────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.toLowerCase() !== "null" ? t.slice(0, 120) : null;
}

function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number.isNaN(Date.parse(s)) ? null : s;
}

/** Coerce the model's JSON into an ExtractedOrder. Rows without a usable price are dropped. */
export function normalizeOrder(raw: any): ExtractedOrder {
  const platform = String(raw?.platform || "").toLowerCase() as OrderPlatform;

  const items: ExtractedItem[] = [];
  for (const it of Array.isArray(raw?.items) ? raw.items : []) {
    const name = str(it?.name);
    const qtyNum = Number(it?.qty);
    const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? Math.round(qtyNum * 1000) / 1000 : 1;
    const unitPrice = toMoney(it?.unitPrice);
    let lineTotal = toMoney(it?.lineTotal);
    if (lineTotal === null && unitPrice !== null) lineTotal = round2(unitPrice * qty);
    if (!name || lineTotal === null) continue;
    items.push({ name, variant: str(it?.variant), qty, unitPrice, lineTotal, grounded: true });
  }

  const fees: ExtractedFee[] = [];
  for (const f of Array.isArray(raw?.fees) ? raw.fees : []) {
    const amount = toMoney(f?.amount);
    if (amount === null || amount === 0) continue; // "Free delivery ₹0" changes nothing
    const kind = String(f?.kind || "").toLowerCase() as FeeKind;
    fees.push({
      kind: (FEE_KINDS as readonly string[]).includes(kind) ? kind : "other",
      label: str(f?.label) || "Fee",
      amount,
      grounded: true,
    });
  }

  const discounts: ExtractedDiscount[] = [];
  for (const d of Array.isArray(raw?.discounts) ? raw.discounts : []) {
    const amount = toMoney(d?.amount);
    if (amount === null || amount === 0) continue;
    discounts.push({ label: str(d?.label) || "Discount", amount, grounded: true });
  }

  return {
    platform: (ORDER_PLATFORMS as readonly string[]).includes(platform) ? platform : "other",
    orderId: str(raw?.orderId),
    orderDate: isoDate(raw?.orderDate),
    items,
    fees,
    discounts,
    grandTotal: toMoney(raw?.grandTotal),
    grandTotalGrounded: true,
    page: {
      hasHeader: Boolean(raw?.page?.hasHeader),
      hasTotal: Boolean(raw?.page?.hasTotal ?? raw?.grandTotal != null),
    },
  };
}

// ── Grounding ──────────────────────────────────────────────────────────────────

/** Mark every money value that does not appear in the OCR text. Returns the share grounded (0–1). */
export function groundOrder(order: ExtractedOrder, ocrText: string): number {
  const numbers = numbersInText(ocrText);
  let checked = 0;
  let ok = 0;
  const mark = (value: number) => {
    const g = grounded(value, numbers);
    checked++;
    if (g) ok++;
    return g;
  };
  for (const it of order.items) it.grounded = mark(it.lineTotal);
  for (const f of order.fees) f.grounded = mark(f.amount);
  for (const d of order.discounts) d.grounded = mark(d.amount);
  if (order.grandTotal !== null) order.grandTotalGrounded = mark(order.grandTotal);
  return checked === 0 ? 0 : ok / checked;
}

// ── Totals ─────────────────────────────────────────────────────────────────────

export function checkTotals(order: Pick<ExtractedOrder, "items" | "fees" | "discounts" | "grandTotal">): TotalsCheck {
  const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
  const itemsTotal = sum(order.items.map((i) => i.lineTotal));
  const feesTotal = sum(order.fees.map((f) => f.amount));
  const discountsTotal = sum(order.discounts.map((d) => d.amount));
  const computedTotal = round2(itemsTotal + feesTotal - discountsTotal);

  if (order.items.length === 0) {
    return { status: "no_items", itemsTotal, feesTotal, discountsTotal, computedTotal, difference: null };
  }
  if (order.grandTotal === null) {
    return { status: "no_total", itemsTotal, feesTotal, discountsTotal, computedTotal, difference: null };
  }
  const difference = round2(order.grandTotal - computedTotal);
  return {
    status: Math.abs(difference) <= TOTALS_TOLERANCE ? "ok" : "mismatch",
    itemsTotal,
    feesTotal,
    discountsTotal,
    computedTotal,
    difference,
  };
}

/**
 * Should the phone retry this one image with the vision model?
 * Only when the text route clearly failed — app screenshots should almost never need it.
 */
export function needsVisionBackup(order: ExtractedOrder, groundedShare: number, ocrConfidence: number): boolean {
  if (order.items.length === 0) return true;
  if (groundedShare < 0.8) return true;
  const totals = checkTotals(order);
  if (totals.status === "mismatch" && ocrConfidence < 75) return true;
  return false;
}
