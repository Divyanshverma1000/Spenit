/**
 * billPrint.ts: the prints a scanned bill leaves, so Spenit can say "you added this before".
 *   screenshot  SHA-256 of the picture file
 *   order       platform + order number (orderKey in orderImport.ts)
 *   contents    hash of the shop, total and every item with its price
 * Matching never blocks a save: the same items at the same price can be a reorder.
 * The backend side is backend/src/lib/seenBills.ts. Pure apart from crypto.subtle; tested.
 */

/** First 12 bytes of SHA-256, as hex: plenty to tell screenshots apart. */
export async function hashBytes(buf: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf as BufferSource);
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const rupees = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export interface BillContents {
  platform?: string | null;
  merchant?: string | null;
  payee?: string | null;
  grandTotal?: number | null;
  itemTotal?: number | null;
  orderDate?: string | null;
  items: { name: string; lineTotal: number }[];
}

/**
 * What the bill says, written the same way every time it's read: shop, total, items sorted.
 * Null when there's too little to tell bills apart (a bare amount matches far too much).
 */
export function contentsText(o: BillContents): string | null {
  const total = o.grandTotal ?? o.itemTotal ?? o.items.reduce((a, i) => a + i.lineTotal, 0);
  if (!(total > 0)) return null;
  const shop = norm(o.platform && o.platform !== "other" ? o.platform : o.merchant || o.payee);
  const items = o.items
    .filter((i) => norm(i.name))
    .map((i) => `${norm(i.name)}=${rupees(i.lineTotal)}`)
    .sort();
  if (items.length > 0) return `v1|${shop}|${rupees(total)}|${items.join(";")}`;
  // No items (a payment, a one-line receipt): only with a name and the date printed on it.
  if (!shop || !o.orderDate) return null;
  return `v1|${shop}|${rupees(total)}|${o.orderDate}`;
}

export async function contentsHash(o: BillContents): Promise<string | null> {
  const t = contentsText(o);
  return t ? hashBytes(new TextEncoder().encode(t)) : null;
}

export type SeenHow = "screenshot" | "order" | "contents";

/** An earlier bill this one looks like (POST /expenses/seen-bills). */
export interface SeenMatch {
  ref: string;
  how: SeenHow;
  place: "group" | "personal";
  expenseId: string;
  groupId: string | null;
  groupName: string | null;
  sameGroup: boolean;
  description: string;
  amount: number;
  addedAt: string;
  addedBy: string | null;
  addedByMe: boolean;
  orderDate: string | null;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

const dayLabel = (iso: string, now: Date) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
};

/** The reminder, in words: a headline, what and when it was added, and why it may still be fine. */
export function seenWords(m: SeenMatch, now = new Date()): { title: string; detail: string; hint: string } {
  const title =
    m.how === "screenshot" ? "You've added this screenshot before"
    : m.how === "order" ? "This order number was added before"
    : "Same items and total as an earlier bill";
  const added = new Date(m.addedAt);
  const time = added.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const who = m.addedByMe ? "you" : m.addedBy || "someone";
  const where = m.place === "personal" ? "your own spending" : m.sameGroup ? "this group" : m.groupName || "another group";
  const ordered = m.orderDate ? ` · ordered ${dayLabel(m.orderDate, now)}` : "";
  const detail = `${m.description} · ${inr(m.amount)}${ordered} · added ${dayLabel(m.addedAt, now)}, ${time} by ${who} in ${where}`;
  const hint =
    m.how === "screenshot" ? "Adding it again would count the same bill twice."
    : m.how === "order" ? "The same order number is usually the same order."
    : "It could be a reorder of the same things, so it's your call.";
  return { title, detail, hint };
}
