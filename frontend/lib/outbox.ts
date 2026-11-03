import { get, set } from "idb-keyval";

/**
 * Outbox: expenses created while offline (or on a bad network) are stored here
 * and sent later. Every item carries its own Idempotency-Key, so a retry after a
 * timeout can never create the expense twice (POST /expenses honours the key).
 */

export interface ExpenseDraft {
  groupId: string;
  description: string;
  amount: number;
  currency?: string;
  splitType: "equal" | "exact" | "fairshare";
  payers: { userId: string; amountPaid: number }[];
  participants: { userId: string; shareAmount?: number; personalAmount?: number }[];
  category?: string | null;
  receiptData?: unknown;
}

export interface OutboxItem {
  id: string; // also used as the Idempotency-Key
  createdAt: string;
  draft: ExpenseDraft;
  status: "pending" | "failed";
  error?: string;
}

const KEY = "spenit-outbox";

export async function loadOutbox(): Promise<OutboxItem[]> {
  try {
    return (await get<OutboxItem[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function saveOutbox(items: OutboxItem[]): Promise<void> {
  try {
    await set(KEY, items);
  } catch {}
}

export function newOutboxItem(draft: ExpenseDraft): OutboxItem {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    draft,
    status: "pending",
  };
}
