/**
 * billDetails.ts — read the item list saved with an imported order (split_type 'itemized')
 * for the expense details screen: the whole bill, and the part one person is in.
 * Pure; tested in billDetails.test.ts.
 */

export interface BillItem {
  index: number; // position in receiptData.items (used to show/hide it)
  name: string | null; // null = someone else's private item
  variant: string | null;
  qty: number | null;
  lineTotal: number;
  sharedBy: string[];
  /** the one person it belongs to, when nobody shares it with them */
  owner: string | null;
  masked: boolean;
  /** an owner's item they chose to show to the group */
  visible: boolean;
}

export interface Bill {
  platform: string | null;
  orderId: string | null;
  orderDate: string | null;
  items: BillItem[];
  fees: { label: string; amount: number }[];
  discounts: { label: string; amount: number }[];
  feePolicy: "proportional" | "equal" | "payer";
  itemsTotal: number;
  extras: number; // fees − discounts
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The bill behind an expense, or null when it wasn't an imported order. */
export function readBill(receiptData: unknown): Bill | null {
  if (!receiptData || typeof receiptData !== "object" || Array.isArray(receiptData)) return null;
  const r = receiptData as Record<string, unknown>;
  if (!Array.isArray(r.items) || r.items.length === 0) return null;
  const items: BillItem[] = (r.items as Record<string, unknown>[]).map((it, index) => {
    const sharedBy = Array.from(new Set(Array.isArray(it.sharedBy) ? (it.sharedBy as string[]) : []));
    return {
      index,
      name: typeof it.name === "string" ? it.name : null,
      variant: typeof it.variant === "string" && it.variant ? it.variant : null,
      qty: typeof it.qty === "number" ? it.qty : null,
      lineTotal: num(it.lineTotal),
      sharedBy,
      owner: sharedBy.length === 1 ? sharedBy[0] : null,
      masked: it.masked === true,
      visible: it.visible === true,
    };
  });
  const list = (v: unknown) =>
    (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
      .map((x) => ({ label: String(x.label ?? "") || "Fee", amount: num(x.amount) }))
      .filter((x) => x.amount !== 0);
  const fees = list(r.fees);
  const discounts = list(r.discounts);
  const itemsTotal = r2(items.reduce((a, i) => a + i.lineTotal, 0));
  const extras = r2(fees.reduce((a, f) => a + f.amount, 0) - discounts.reduce((a, d) => a + d.amount, 0));
  const fp = r.feePolicy;
  return {
    platform: typeof r.platform === "string" ? r.platform : null,
    orderId: typeof r.orderId === "string" && r.orderId ? r.orderId : null,
    orderDate: typeof r.orderDate === "string" && r.orderDate ? r.orderDate : null,
    items,
    fees,
    discounts,
    feePolicy: fp === "equal" || fp === "payer" ? fp : "proportional",
    itemsTotal,
    extras,
  };
}

/** What one person is in on this bill. `share` is their saved share (the source of truth). */
export function myPart(bill: Bill, me: string, share: number) {
  const items = bill.items
    .filter((i) => i.sharedBy.includes(me))
    .map((i) => ({ ...i, mine: r2(i.lineTotal / i.sharedBy.length) }));
  const itemsTotal = r2(items.reduce((a, i) => a + i.mine, 0));
  // Fees/discounts/rounding are whatever is left of the saved share.
  return { items, itemsTotal, extras: r2(share - itemsTotal), share: r2(share) };
}

export const FEE_POLICY_TEXT: Record<Bill["feePolicy"], string> = {
  proportional: "Fees and discounts split by how much each person ordered",
  equal: "Fees and discounts split equally among people with items",
  payer: "Fees and discounts paid by the person who paid",
};
