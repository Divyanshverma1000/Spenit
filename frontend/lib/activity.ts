/**
 * activity.ts — turn group activity rows into something easy to scan: who (coloured
 * name), what they did, the bill or amount it was about, and for edits each change as
 * old → new. Pure; tested in activity.test.ts.
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

/** A piece of the headline: a person (coloured), plain words, or a bold thing. */
export type Part =
  | { t: "person"; text: string; id?: string | null }
  | { t: "text"; text: string }
  | { t: "thing"; text: string };

export type Category = "bills" | "payments" | "people";
export type Tone = "added" | "changed" | "removed" | "money" | "good" | "bad" | "people" | "fix";

export interface Described {
  parts: Part[];
  /** the money it was about, shown as a pill */
  amount: string | null;
  tone: Tone;
  category: Category;
  /** short label on the card ("Edited", "Payment", "Name fix") */
  label: string;
}

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
export const money = (v: unknown) =>
  `₹${num(v).toLocaleString("en-IN", { minimumFractionDigits: num(v) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function describe(a: ActivityItem, me?: string): Described {
  const s = a.summary ?? {};
  const actor: Part = a.actor
    ? { t: "person", text: a.actor.id === me ? "You" : a.actor.name, id: a.actor.id }
    : { t: "person", text: "Someone" };
  const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : "someone");
  const person = (k: string, id?: string | null): Part => ({ t: "person", text: id && id === me ? "you" : str(k), id: id ?? null });
  const idOf = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : null);
  const txt = (text: string): Part => ({ t: "text", text });
  const exp = (s.after ?? s.before) as Snapshot | undefined;
  const bill: Part = { t: "thing", text: exp?.description ?? "a bill" };
  const D = (parts: Part[], tone: Tone, category: Category, label: string, amount: unknown = null): Described => ({
    parts, tone, category, label, amount: amount === null ? null : money(amount),
  });

  switch (a.kind) {
    case "expense_added": return D([actor, txt("added"), bill], "added", "bills", "New bill", exp?.amount);
    case "expense_edited": return D([actor, txt("edited"), bill], "changed", "bills", "Edited", s.after ? (s.after as Snapshot).amount : null);
    case "expense_deleted": return D([actor, txt("deleted"), bill], "removed", "bills", "Deleted", exp?.amount);
    case "expense_restored": return D([actor, txt("restored"), bill], "added", "bills", "Restored", exp?.amount);
    case "settlement_recorded": return D([actor, txt("recorded"), person("from", idOf("fromId")), txt("paying"), person("to", idOf("toId"))], "money", "payments", "Payment", s.amount);
    case "settlement_confirmed": return D([actor, txt("confirmed"), person("from", idOf("fromId")), txt("paid"), person("to", idOf("toId"))], "good", "payments", "Confirmed", s.amount);
    case "settlement_rejected": return D([actor, txt("said a payment from"), person("from", idOf("fromId")), txt("didn't arrive")], "bad", "payments", "Rejected", s.amount);
    case "member_joined": return D([person("name", a.targetUser), txt("joined the group")], "people", "people", "Joined");
    case "member_claimed":
      return s.reassigned
        ? D([actor, txt("moved"), person("accountName", a.targetUser), txt("to the name"), { t: "thing", text: str("placeholderName") }], "fix", "people", "Name fix")
        : D([person("accountName", a.targetUser), txt("joined as"), { t: "thing", text: str("placeholderName") }], "people", "people", "Joined");
    case "claim_undone":
      return D([actor, txt("undid"), person("claimerName", a.targetUser), txt("joining as"), { t: "thing", text: str("placeholderName") }], "fix", "people", "Name fix");
    case "member_left": return D([person("name", a.targetUser), txt("left the group")], "people", "people", "Left");
    case "member_removed": return D([actor, txt("removed"), person("name", a.targetUser)], "removed", "people", "Removed");
    case "member_added": return D([actor, txt("added"), person("name", a.targetUser), txt("(not joined yet)")], "people", "people", "Added");
    case "invite_disputed":
      return D([actor, txt("said the invite for"), { t: "thing", text: str("placeholderName") }, txt("isn't for them")], "bad", "people", "Wrong invite");
    case "account_deleted": return D([person("name", a.targetUser), txt("deleted their account")], "people", "people", "Left");
    default: return D([actor, txt("made a change")], "changed", "bills", "Change");
  }
}

/** The headline as plain text (screen readers, tests). */
export function sentence(a: ActivityItem, me?: string): string {
  return describe(a, me).parts.map((p) => p.text).join(" ");
}

export interface Change { label: string; from: string | null; to: string | null }

/** What an edit changed: name, total, who paid, and each person's share. */
export function changes(before?: Snapshot | null, after?: Snapshot | null): Change[] {
  if (!before || !after) return [];
  const out: Change[] = [];
  if (before.description !== after.description) out.push({ label: "Name", from: before.description, to: after.description });
  if (num(before.amount) !== num(after.amount)) out.push({ label: "Total", from: money(before.amount), to: money(after.amount) });
  const payers = (x: Snapshot) => x.paidBy.map((p) => `${p.name} ${money(p.amount)}`).join(", ");
  if (payers(before) !== payers(after) && before.paidBy.map((p) => p.userId).join() !== after.paidBy.map((p) => p.userId).join())
    out.push({ label: "Paid by", from: payers(before) || null, to: payers(after) || null });
  const ids = new Set([...before.shares.map((s) => s.userId), ...after.shares.map((s) => s.userId)]);
  for (const id of ids) {
    const b = before.shares.find((s) => s.userId === id);
    const a = after.shares.find((s) => s.userId === id);
    const name = (a ?? b)!.name;
    if (!b) out.push({ label: name, from: null, to: money(a!.amount) });
    else if (!a) out.push({ label: name, from: money(b.amount), to: null });
    else if (num(a.amount) !== num(b.amount)) out.push({ label: name, from: money(b.amount), to: money(a.amount) });
  }
  return out;
}

/** "Today", "Yesterday", or "Mon, 3 Nov". */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
