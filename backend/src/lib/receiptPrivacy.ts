/**
 * receiptPrivacy.ts — who can see which item of an imported order.
 *
 * An item that only one person shares is that person's private item. Other group members
 * see its price (so the bill still adds up) but not what it was, until its owner chooses
 * to show it (item.visible = true). The owner and the person who added the bill (they
 * made the split from the screenshot) always see everything. Shared items are never hidden.
 *
 * Only applies to imported orders (split_type 'itemized', receiptData.items). Pure.
 */

export interface ReceiptItem {
  name?: string | null;
  variant?: string | null;
  qty?: number | null;
  lineTotal: number;
  sharedBy: string[];
  visible?: boolean;
  masked?: boolean;
}

type Receipt = { items?: ReceiptItem[]; [k: string]: unknown };

const isReceipt = (r: unknown): r is Receipt & { items: ReceiptItem[] } =>
  !!r && typeof r === "object" && !Array.isArray(r) && Array.isArray((r as Receipt).items);

/** The one person an item belongs to, or null when it is shared (or nobody's). */
export function soloOwner(item: Pick<ReceiptItem, "sharedBy">): string | null {
  const people = Array.from(new Set(item.sharedBy ?? []));
  return people.length === 1 ? people[0] : null;
}

/** The receipt as `viewerId` may see it. */
export function maskReceipt(receipt: unknown, viewerId: string, creatorId: string): unknown {
  if (!isReceipt(receipt) || viewerId === creatorId) return receipt;
  let changed = false;
  const items = receipt.items.map((it) => {
    const owner = soloOwner(it);
    if (!owner || owner === viewerId || it.visible) return it;
    changed = true;
    return { name: null, variant: null, qty: null, lineTotal: it.lineTotal, sharedBy: it.sharedBy, masked: true };
  });
  return changed ? { ...receipt, items } : receipt;
}

/**
 * Someone who sees a masked receipt edits the bill and sends it back: put the hidden
 * details back from what is stored, so an edit never wipes them. Items are matched by
 * position (the edit form keeps the imported item list as it is).
 */
export function restoreMasked(incoming: unknown, stored: unknown): unknown {
  if (!isReceipt(incoming) || !isReceipt(stored)) return incoming;
  if (!incoming.items.some((it) => it?.masked)) return incoming;
  const items = incoming.items.map((it, i) => {
    if (!it?.masked) return it;
    const orig = stored.items[i];
    return orig ? orig : { ...it, masked: undefined };
  });
  return { ...incoming, items };
}

/**
 * Show or hide some of `userId`'s private items. Returns the new receipt, or an error
 * when an index isn't an item that belongs to them alone.
 */
export function setItemVisibility(
  receipt: unknown,
  userId: string,
  indexes: number[],
  visible: boolean
): { ok: true; receipt: Receipt } | { ok: false; error: string } {
  if (!isReceipt(receipt)) return { ok: false, error: "This expense has no item list" };
  const want = new Set(indexes);
  for (const i of want) {
    const it = receipt.items[i];
    if (!Number.isInteger(i) || !it) return { ok: false, error: `Item ${i + 1} doesn't exist` };
    if (soloOwner(it) !== userId) return { ok: false, error: "You can only show or hide items that are yours alone" };
  }
  const items = receipt.items.map((it, i) => (want.has(i) ? { ...it, visible } : it));
  return { ok: true, receipt: { ...receipt, items } };
}
