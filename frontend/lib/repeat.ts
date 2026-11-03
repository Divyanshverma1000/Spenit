/**
 * "Repeat expense": rebuild an earlier expense in the add-expense form's model
 * (specific items + an equal shared pool), so the copy has the same people and shares.
 */

export interface SpecificItem {
  id: string;
  label: string;
  amount: string;
  sharedBy: string[]; // userIds who share this item
}

export interface RepeatSource {
  amount: string;
  receiptData?: unknown;
  splits: { userId: string; shareAmount: string }[];
}

/**
 * Work out how to rebuild an earlier expense in this form's model
 * (specific items + an equal "shared pool"):
 *  - it had specific items  -> restore them, and the pool is whoever still owed more than their items
 *  - equal split            -> pool = the same people, no items
 *  - uneven custom shares   -> one editable "Custom share" item per person, so every share is reproduced exactly
 */
export function planRepeat(
  source: RepeatSource,
  members: { id: string; name: string }[]
): { items: SpecificItem[]; pool: string[] } {
  const memberIds = new Set(members.map((m) => m.id));
  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.name ?? "Someone";
  const shares = source.splits
    .filter((s) => memberIds.has(s.userId))
    .map((s) => ({ userId: s.userId, share: parseFloat(s.shareAmount) || 0 }))
    .filter((s) => s.share > 0);

  const saved = Array.isArray(source.receiptData) ? (source.receiptData as Partial<SpecificItem>[]) : [];
  const items: SpecificItem[] = saved
    .filter((it) => it && parseFloat(String(it.amount)) > 0)
    .map((it) => ({
      id: crypto.randomUUID(),
      label: it.label ?? "",
      amount: String(it.amount ?? ""),
      sharedBy: (it.sharedBy ?? []).filter((uid) => memberIds.has(uid)),
    }));

  if (items.length > 0) {
    // How much of each person's share came from the specific items?
    const fromItems: Record<string, number> = {};
    items.forEach((it) => {
      const amt = parseFloat(it.amount) || 0;
      if (it.sharedBy.length === 0) return;
      const each = amt / it.sharedBy.length;
      it.sharedBy.forEach((uid) => (fromItems[uid] = (fromItems[uid] ?? 0) + each));
    });
    const pool = shares.filter((s) => s.share - (fromItems[s.userId] ?? 0) > 0.02).map((s) => s.userId);
    return { items, pool };
  }

  const values = shares.map((s) => s.share);
  const isEqual = values.length > 0 && Math.max(...values) - Math.min(...values) <= 0.011;
  if (isEqual) return { items: [], pool: shares.map((s) => s.userId) };

  return {
    items: shares.map((s) => ({
      id: crypto.randomUUID(),
      label: `Custom share: ${nameOf(s.userId)}`,
      amount: s.share.toFixed(2),
      sharedBy: [s.userId],
    })),
    pool: [],
  };
}

