/**
 * activity.ts — turn group activity rows into plain sentences and before/after changes.
 * Pure; tested in activity.test.ts.
 */

export interface Snapshot {
  description: string;
  amount: string;
  currency?: string;
  paidBy: { userId: string; name: string; amount: string }[];
  shares: { userId: string; name: string; amount: string }[];
}

export interface ActivityItem {
  id: number;
  kind: string;
  actor: { id: string; name: string } | null;
  expenseId: string | null;
  expenseDeleted: boolean;
  settlementId: string | null;
  targetUser: string | null;
  summary: Record<string, unknown> & { before?: Snapshot | null; after?: Snapshot | null };
  createdAt: string;
}

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
export const money = (v: unknown) => `₹${num(v).toLocaleString("en-IN", { minimumFractionDigits: num(v) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** One line saying what happened. `me` turns your own name into "You". */
export function sentence(a: ActivityItem, me?: string): string {
  const who = a.actor ? (a.actor.id === me ? "You" : a.actor.name) : "Someone";
  const s = a.summary ?? {};
  const exp = (s.after ?? s.before) as Snapshot | undefined;
  const what = exp ? `"${exp.description}" (${money(exp.amount)})` : "an expense";
  const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : "someone");
  switch (a.kind) {
    case "expense_added": return `${who} added ${what}`;
    case "expense_edited": return `${who} changed ${exp ? `"${exp.description}"` : "an expense"}`;
    case "expense_deleted": return `${who} deleted ${what}`;
    case "expense_restored": return `${who} restored ${what}`;
    case "settlement_recorded": return `${who} recorded ${str("from")} paying ${str("to")} ${money(s.amount)}`;
    case "settlement_confirmed": return `${who} confirmed ${str("from")} paid ${str("to")} ${money(s.amount)}`;
    case "settlement_rejected": return `${who} said ${str("from")}'s ${money(s.amount)} payment to ${str("to")} didn't arrive`;
    case "member_joined": return `${str("name")} joined the group`;
    case "member_claimed":
      return s.reassigned
        ? `${who} moved ${str("accountName")} to ${str("placeholderName")}`
        : `${str("accountName")} joined as ${str("placeholderName")}`;
    case "claim_undone": return `${who} undid ${str("claimerName")} joining as ${str("placeholderName")}`;
    case "member_left": return `${str("name")} left the group`;
    case "member_removed": return `${who} removed ${str("name")}`;
    case "member_added": return `${who} added ${str("name")} (not joined yet)`;
    default: return `${who} made a change`;
  }
}

/** What an edit changed: description, total, payers, and each person's share. */
export function changes(before?: Snapshot | null, after?: Snapshot | null): string[] {
  if (!before || !after) return [];
  const out: string[] = [];
  if (before.description !== after.description) out.push(`Name: "${before.description}" → "${after.description}"`);
  if (num(before.amount) !== num(after.amount)) out.push(`Total: ${money(before.amount)} → ${money(after.amount)}`);
  const payers = (x: Snapshot) => x.paidBy.map((p) => `${p.name} ${money(p.amount)}`).join(", ");
  if (payers(before) !== payers(after)) out.push(`Paid by: ${payers(before) || "nobody"} → ${payers(after) || "nobody"}`);
  const ids = new Set([...before.shares.map((s) => s.userId), ...after.shares.map((s) => s.userId)]);
  for (const id of ids) {
    const b = before.shares.find((s) => s.userId === id);
    const a = after.shares.find((s) => s.userId === id);
    const name = (a ?? b)!.name;
    if (!b) out.push(`${name} added: ${money(a!.amount)}`);
    else if (!a) out.push(`${name} removed (was ${money(b.amount)})`);
    else if (num(a.amount) !== num(b.amount)) out.push(`${name}: ${money(b.amount)} → ${money(a.amount)}`);
  }
  return out;
}
