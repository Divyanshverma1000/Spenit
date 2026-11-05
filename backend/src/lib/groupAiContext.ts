/**
 * groupAiContext.ts — everything the group chat assistant needs to know, as compact text.
 *
 * Models are bad at adding up long lists, so every total is worked out here (balances,
 * who should pay whom, spend by category / month / kind of item, each person's share)
 * and the model only has to read. Text instead of JSON keeps it to a few thousand
 * tokens, which matters on Groq's per-minute token limits.
 *
 * Item lists come from listGroupExpenses(groupId, viewerId), so other people's private
 * items are already masked: they count in totals as "private items" with no name.
 * Pure; tested in groupAiContext.test.ts.
 */

export interface CtxMember { id: string; name: string; isPlaceholder?: boolean }
export interface CtxExpense {
  id: string;
  description: string;
  amount: string | number;
  category?: string | null;
  createdAt: string | Date;
  createdBy?: { id: string; name: string };
  receiptData?: unknown;
  payers: { userId: string; name: string; amountPaid: string | number }[];
  splits: { userId: string; name: string; shareAmount: string | number }[];
}
export interface CtxSettlement {
  amount: string | number;
  status: string;
  method?: string | null;
  createdAt: string | Date;
  fromUser: { id: string; name: string };
  toUser: { id: string; name: string };
}
export interface CtxBalance {
  memberBalances: { userId: string; name: string; signedAmount: string }[];
  simplifiedTransfers: { from: string; to: string; amount: string; fromName: string; toName: string }[];
}

export interface GroupContext {
  text: string;
  /** "E1" → expense id, for answers that point at bills */
  refs: Record<string, string>;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => `₹${r2(n).toFixed(2)}`;
const day = (d: string | Date) => new Date(d).toISOString().slice(0, 10);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const SIZE = /\b\d+(\.\d+)?\s*(g|gm|kg|ml|l|ltr|litre|pcs?|pieces?|units?|pack|x)\b/gi;
const FILLER = new Set(["pack", "combo", "pouch", "bottle", "can", "jar", "box", "tin", "set", "of", "and", "with", "new", "fresh", "premium", "family", "value", "mini", "large", "small", "big"]);

/** What an item is in a word or two: the model's `short`, else a guess from the name. */
export function itemKind(it: { name?: unknown; short?: unknown }): string | null {
  if (typeof it.short === "string" && it.short.trim()) return it.short.trim().toLowerCase();
  if (typeof it.name !== "string" || !it.name) return null;
  const words = it.name
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(SIZE, " ")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !FILLER.has(w));
  return words.length ? words.slice(-2).join(" ") : null;
}

interface Item { name: string | null; short: string | null; qty: number | null; lineTotal: number; sharedBy: string[]; masked: boolean }
interface Bill { items: Item[]; fees: { label: string; amount: number }[]; discounts: { label: string; amount: number }[]; platform: string | null }

function readBill(rd: unknown): Bill | null {
  if (!rd || typeof rd !== "object" || Array.isArray(rd)) return null;
  const r = rd as Record<string, unknown>;
  if (!Array.isArray(r.items) || r.items.length === 0) return null;
  const items = (r.items as Record<string, unknown>[]).map((it) => ({
    name: typeof it.name === "string" ? it.name : null,
    short: typeof it.short === "string" ? it.short : null,
    qty: typeof it.qty === "number" ? it.qty : null,
    lineTotal: num(it.lineTotal),
    sharedBy: Array.from(new Set(Array.isArray(it.sharedBy) ? (it.sharedBy as string[]) : [])),
    masked: it.masked === true,
  }));
  const list = (v: unknown) =>
    (Array.isArray(v) ? (v as Record<string, unknown>[]) : [])
      .map((x) => ({ label: String(x.label ?? "") || "Fee", amount: num(x.amount) }))
      .filter((x) => x.amount !== 0);
  return { items, fees: list(r.fees), discounts: list(r.discounts), platform: typeof r.platform === "string" ? r.platform : null };
}

/** Older hand-typed "specific items" ([{label, amount, sharedBy}]) read as items too. */
function legacyItems(rd: unknown): Item[] {
  if (!Array.isArray(rd)) return [];
  return (rd as Record<string, unknown>[])
    .filter((x) => x && typeof x.label === "string" && num(x.amount) > 0)
    .map((x) => ({
      name: x.label as string, short: null, qty: null, lineTotal: num(x.amount),
      sharedBy: Array.isArray(x.sharedBy) ? (x.sharedBy as string[]) : [], masked: false,
    }));
}

export function buildGroupContext(input: {
  groupName: string;
  viewerId: string;
  members: CtxMember[];
  expenses: CtxExpense[]; // newest first
  settlements: CtxSettlement[];
  balance: CtxBalance | null;
  today?: Date;
  /** rough size cap for the expense list (characters) */
  budget?: number;
}): GroupContext {
  const { viewerId, members, expenses, settlements, balance } = input;
  const budget = input.budget ?? 9000;
  const nameOf = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m ? m.name + (id === viewerId ? " (you)" : "") : "someone who left";
  };
  const L: string[] = [];

  L.push(`TODAY: ${day(input.today ?? new Date())}`);
  L.push(`GROUP: ${input.groupName}`);
  L.push(`YOU ARE: ${nameOf(viewerId)}`);
  L.push(`MEMBERS: ${members.map((m) => m.name + (m.id === viewerId ? " (you)" : "") + (m.isPlaceholder ? " [hasn't joined the app yet]" : "")).join(", ")}`);

  // ── Balances: what is still open ──────────────────────────────────────────
  L.push("", "BALANCES NOW (every expense minus confirmed payments; this is what is still pending):");
  const bal = balance?.memberBalances ?? [];
  if (bal.every((b) => Math.abs(num(b.signedAmount)) < 0.005)) L.push("- Everyone is settled up. Nobody owes anything.");
  for (const b of bal) {
    const v = num(b.signedAmount);
    if (Math.abs(v) < 0.005) L.push(`- ${nameOf(b.userId)}: settled`);
    else L.push(`- ${nameOf(b.userId)}: ${v > 0 ? "should get back" : "owes"} ${inr(Math.abs(v))}`);
  }
  if (balance?.simplifiedTransfers.length) {
    L.push("TO SETTLE UP, these payments are still due:");
    for (const t of balance.simplifiedTransfers) L.push(`- ${nameOf(t.from)} pays ${nameOf(t.to)} ${inr(num(t.amount))}`);
  }

  // ── Payments people recorded ──────────────────────────────────────────────
  L.push("", "PAYMENTS RECORDED (Settle Up):");
  if (settlements.length === 0) L.push("- none yet");
  for (const s of settlements.slice(0, 30)) {
    const state =
      s.status === "confirmed" ? "confirmed, counted in balances"
      : s.status === "pending" ? `waiting for ${nameOf(s.toUser.id)} to confirm, NOT counted in balances yet`
      : "rejected, not counted";
    L.push(`- ${day(s.createdAt)} ${nameOf(s.fromUser.id)} paid ${nameOf(s.toUser.id)} ${inr(num(s.amount))}${s.method ? ` by ${s.method}` : ""} · ${state}`);
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  let total = 0, myPaid = 0, myShare = 0;
  const byCat = new Map<string, { total: number; mine: number; n: number }>();
  const byMonth = new Map<string, { total: number; mine: number }>();
  const byPerson = new Map<string, { paid: number; share: number }>();
  const kinds = new Map<string, { total: number; mine: number; rows: number }>();
  let privateTotal = 0, privateRows = 0;

  for (const e of expenses) {
    const amt = num(e.amount);
    total += amt;
    const mine = num(e.splits.find((s) => s.userId === viewerId)?.shareAmount);
    myShare += mine;
    myPaid += num(e.payers.find((p) => p.userId === viewerId)?.amountPaid);
    const cat = e.category || "Uncategorised";
    const c = byCat.get(cat) ?? { total: 0, mine: 0, n: 0 };
    c.total += amt; c.mine += mine; c.n++; byCat.set(cat, c);
    const month = day(e.createdAt).slice(0, 7);
    const mo = byMonth.get(month) ?? { total: 0, mine: 0 };
    mo.total += amt; mo.mine += mine; byMonth.set(month, mo);
    for (const p of e.payers) { const x = byPerson.get(p.userId) ?? { paid: 0, share: 0 }; x.paid += num(p.amountPaid); byPerson.set(p.userId, x); }
    for (const s of e.splits) { const x = byPerson.get(s.userId) ?? { paid: 0, share: 0 }; x.share += num(s.shareAmount); byPerson.set(s.userId, x); }

    const items = readBill(e.receiptData)?.items ?? legacyItems(e.receiptData);
    for (const it of items) {
      if (it.masked) { privateTotal += it.lineTotal; privateRows++; continue; }
      const k = itemKind(it);
      if (!k) continue;
      const x = kinds.get(k) ?? { total: 0, mine: 0, rows: 0 };
      x.total += it.lineTotal; x.rows++;
      if (it.sharedBy.includes(viewerId) && it.sharedBy.length) x.mine += it.lineTotal / it.sharedBy.length;
      kinds.set(k, x);
    }
  }

  L.push("", "TOTALS (all expenses in the group):");
  if (expenses.length === 0) L.push("- No expenses yet.");
  else {
    const first = day(expenses[expenses.length - 1].createdAt), last = day(expenses[0].createdAt);
    L.push(`- ${expenses.length} expenses, ${inr(total)} in all, from ${first} to ${last}`);
    L.push(`- You paid ${inr(myPaid)} and your share is ${inr(myShare)}`);
    for (const [id, x] of byPerson) L.push(`- ${nameOf(id)}: paid ${inr(x.paid)}, share ${inr(x.share)}`);
    L.push("BY CATEGORY: " + [...byCat].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => `${k} ${inr(v.total)} (${v.n}, your share ${inr(v.mine)})`).join("; "));
    if (byMonth.size > 1) L.push("BY MONTH: " + [...byMonth].sort().map(([k, v]) => `${k} ${inr(v.total)} (your share ${inr(v.mine)})`).join("; "));
  }

  if (kinds.size || privateRows) {
    L.push("", "ITEMS BOUGHT, grouped by what they are (total price · your part · times bought):");
    const sorted = [...kinds].sort((a, b) => b[1].total - a[1].total);
    for (const [k, v] of sorted.slice(0, 80)) L.push(`- ${k}: ${inr(v.total)} · you ${inr(v.mine)} · ${v.rows}x`);
    if (sorted.length > 80) L.push(`- …and ${sorted.length - 80} more kinds of items`);
    if (privateRows) L.push(`- private items (only the person who had them can see what they were): ${inr(privateTotal)} in ${privateRows} rows`);
  }

  // ── Each expense, newest first, until the budget runs out ─────────────────
  L.push("", "EXPENSES (newest first; ref in brackets):");
  const refs: Record<string, string> = {};
  let used = 0, shown = 0;
  for (const [i, e] of expenses.entries()) {
    const ref = `E${i + 1}`;
    const head =
      `[${ref}] ${day(e.createdAt)} "${clip(e.description, 60)}" ${inr(num(e.amount))} · ${e.category || "Uncategorised"}` +
      ` · paid by ${e.payers.map((p) => `${nameOf(p.userId)} ${inr(num(p.amountPaid))}`).join(", ")}` +
      ` · shares: ${e.splits.map((s) => `${nameOf(s.userId).replace(" (you)", "")} ${inr(num(s.shareAmount))}`).join(", ")}` +
      (e.createdBy ? ` · added by ${nameOf(e.createdBy.id)}` : "");
    const bill = readBill(e.receiptData);
    const items = bill?.items ?? legacyItems(e.receiptData);
    let detail = "";
    if (items.length) {
      detail = "\n   items: " + items.map((it) => {
        const who = it.sharedBy.map((u) => nameOf(u).split(" ")[0]).join("+");
        if (it.masked) return `private item ${inr(it.lineTotal)} [${who}]`;
        const kind = itemKind(it);
        return `${clip(it.name ?? "item", 40)}${kind && !(it.name ?? "").toLowerCase().includes(kind) ? ` (${kind})` : ""}${it.qty && it.qty > 1 ? ` x${it.qty}` : ""} ${inr(it.lineTotal)} [${who}]`;
      }).join("; ");
      if (bill?.fees.length) detail += "; fees: " + bill.fees.map((f) => `${f.label} ${inr(f.amount)}`).join(", ");
      if (bill?.discounts.length) detail += "; discounts: " + bill.discounts.map((d) => `${d.label} -${inr(d.amount)}`).join(", ");
    }
    const line = used + head.length + detail.length <= budget ? head + detail : head;
    if (used + line.length > budget * 1.4) break;
    refs[ref] = e.id;
    L.push(line);
    used += line.length;
    shown++;
  }
  if (shown < expenses.length) L.push(`…and ${expenses.length - shown} older expenses not listed one by one (they ARE included in every total above).`);

  return { text: L.join("\n"), refs };
}
