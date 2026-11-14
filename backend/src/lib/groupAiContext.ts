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

export interface MatchRow { id: string; expenseId: string; name: string; qty: number | null; price: number; mine: number }
export interface GroupContext {
  text: string;
  /** "E1" → expense id, for answers that point at bills */
  refs: Record<string, string>;
  /** "I1" → one item matching the question, for answers the server writes out exactly */
  items: Record<string, MatchRow>;
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

// ── Items the question is about ───────────────────────────────────────────────

/** Words people use → what the item names actually say ("ice cream" → Cornetto, cone, kulfi…). */
const SYNONYMS: Record<string, string[]> = {
  icecream: ["ice cream", "icecream", "cornetto", "cone", "kulfi", "frozen dessert", "sundae", "gelato", "magnum", "tub", "kwality", "havmor", "baskin", "hocco", "vadilal", "amul ice"],
  chips: ["chips", "crisps", "kurkure", "lays", "lay s", "bingo", "pringles", "nachos", "doritos", "uncle chips", "wafer"],
  snack: ["snack", "namkeen", "bhujia", "mixture", "biscuit", "cookie", "chips", "crisps", "kurkure", "nachos", "popcorn", "wafer", "chakli", "makhana", "puffs", "chocolate", "instant noodles"],
  chocolate: ["chocolate", "dairy milk", "kitkat", "kit kat", "5 star", "snickers", "munch", "perk", "silk", "ferrero", "kinder", "bournville", "cadbury"],
  drink: ["cola", "coke", "pepsi", "sprite", "thums up", "fanta", "juice", "soda", "red bull", "energy drink", "lassi", "buttermilk", "chaas"],
  milk: ["milk", "toned", "doodh"],
  vegetable: ["onion", "tomato", "potato", "lady", "bhindi", "capsicum", "coriander", "chilli", "garlic", "ginger", "cabbage", "cauliflower", "spinach", "palak", "carrot", "cucumber", "beans", "peas", "brinjal", "lemon", "mint", "methi"],
  fruit: ["banana", "apple", "mango", "grapes", "orange", "papaya", "watermelon", "pomegranate", "kiwi", "guava", "sitaphal", "pear"],
  print: ["print", "file", "poster", "page"],
  stationery: ["glue", "fevistik", "scissors", "pen", "pencil", "notebook", "tape", "stapler"],
};
// "unhealthy" / "junk": junk food, sweets, fried snacks, ice cream, chocolate, fizzy drinks.
const FIZZY = ["cola", "coke", "pepsi", "sprite", "fanta", "thums up", "mountain dew", "7up", "mirinda", "limca", "red bull", "energy drink", "soft drink", "cold drink", "soda"];
SYNONYMS.unhealthy = Array.from(new Set([...SYNONYMS.icecream, ...SYNONYMS.chips, ...SYNONYMS.snack, ...SYNONYMS.chocolate, ...FIZZY,
  "candy", "cake", "pastry", "donut", "doughnut", "fries", "burger", "pizza", "instant noodles", "noodles", "pasta", "puff", "wafers", "nachos", "gulab jamun", "rasgulla", "jalebi", "mithai"]));
SYNONYMS.junk = SYNONYMS.unhealthy;
SYNONYMS.colddrink = FIZZY;

/** Never counted as junk, whatever else their name says ("Dark Chocolate Peanut Butter", "Masala Magic Cubes"). */
const NOT_JUNK = ["buttermilk", "chaas", "lassi", "curd", "dahi", "yogurt", "ketchup", "sauce", "peanut butter", "oats", "protein", "muesli",
  "magic cubes", "masala cubes", "bournvita", "horlicks", "nutrition", "milk powder", "atta", "rice", "dal", "spice"];

/** Words in the question that ask about junk food, so NOT_JUNK applies. */
export function wantsJunk(question: string): boolean {
  const q = ` ${norm(question)} `;
  return [" unhealthy ", " junk ", " junk food ", " cold drink", " cold drinks "].some((w) => q.includes(w));
}
const STOP = new Set(["how", "much", "many", "what", "did", "do", "i", "we", "me", "my", "on", "for", "the", "a", "an", "and", "or", "of", "in", "spent", "spend", "spending", "bought", "buy", "items", "item", "like", "other", "all", "total", "is", "are", "was", "were", "have", "has", "you", "your", "this", "that", "month", "week", "breakdown", "each", "type", "want", "by", "give", "show", "list", "with", "from", "to", "it", "its", "also", "packed", "food", "things", "stuff", "cost", "price", "prices", "exact", "bills", "bill", "check", "these", "those"]);
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Search phrases from a question: its own words, plus what they usually appear as on bills. */
export function searchTerms(question: string): string[] {
  const q = ` ${norm(question)} `;
  const out = new Set<string>();
  for (const [key, list] of Object.entries(SYNONYMS)) {
    const spaced = key === "icecream" ? "ice cream" : key === "colddrink" ? "cold drink" : key;
    const forms = [key, `${key}s`, spaced, `${spaced}s`, key === "junk" ? "junk food" : key];
    // Only the group's own name switches it on ("snacks", "ice cream", "unhealthy"); a brand
    // in the question ("kurkure") is searched as itself below.
    if (forms.some((f) => q.includes(` ${f} `))) list.forEach((w) => out.add(w));
  }
  for (const w of norm(question).split(" ")) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(w.replace(/(ies)$/, "y").replace(/(es|s)$/, ""));
  }
  return [...out].filter((t) => t.length >= 3);
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
  /** the question (and the one before it): every bill is searched for items it mentions */
  focus?: string;
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

  // ── Items the question asks about, from EVERY bill (nothing left out) ─────
  const refs: Record<string, string> = {};
  const matched: Record<string, MatchRow> = {};
  const terms = input.focus ? searchTerms(input.focus) : [];
  const typed = input.focus ? norm(input.focus) : "";
  const junkOnly = input.focus ? wantsJunk(input.focus) : false;
  let matchedAny = false;
  if (terms.length) {
    const rows: string[] = [];
    let price = 0, mine = 0, n = 0;
    expenses.forEach((e, i) => {
      const items = readBill(e.receiptData)?.items ?? legacyItems(e.receiptData);
      for (const it of items) {
        if (it.masked || !it.name) continue;
        const hay = ` ${norm(`${it.name} ${it.short ?? ""}`)} `;
        const squashed = hay.replace(/ /g, "");
        if (!terms.some((t) => hay.includes(` ${t}`) || (t.length >= 5 && squashed.includes(t.replace(/ /g, ""))))) continue;
        // "unhealthy": leave out staples and healthy items, unless the question names them
        if (junkOnly && NOT_JUNK.some((w) => hay.includes(` ${w}`) && !typed.includes(w))) continue;
        const ref = `E${i + 1}`;
        refs[ref] = e.id;
        const part = it.sharedBy.includes(viewerId) && it.sharedBy.length ? it.lineTotal / it.sharedBy.length : 0;
        price += it.lineTotal; mine += part; n++;
        if (rows.length < 80) {
          const id = `I${rows.length + 1}`;
          matched[id] = { id, expenseId: e.id, name: it.name, qty: it.qty, price: r2(it.lineTotal), mine: r2(part) };
          rows.push(`- ${id} [${ref}] ${day(e.createdAt)}: ${clip(it.name, 60)}${it.qty && it.qty > 1 ? ` x${it.qty}` : ""} ${inr(it.lineTotal)} [${it.sharedBy.map((u) => nameOf(u).split(" ")[0]).join("+")}] · your part ${inr(part)}`);
        }
      }
    });
    L.push("", `ITEMS MATCHING THE QUESTION (searched every bill for: ${terms.slice(0, 12).join(", ")}). This list is COMPLETE and exact: answer item questions ONLY from it, never add others or change prices/quantities:`);
    if (n === 0) L.push("- No matching items on any bill.");
    else {
      L.push(...rows);
      if (n > rows.length) L.push(`- …${n - rows.length} more matching rows (included in the totals below)`);
      L.push(`MATCHING TOTAL: ${n} items, ${inr(price)} in all, your part ${inr(mine)} (item prices, before fees)`);
      matchedAny = true;
    }
  }

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
  // Why shares differ: each person's share split into whole-group, some-of-you and own-only money.
  const memberCount = Math.max(members.length, 1);
  const parts = new Map<string, { everyone: number; some: number; own: number; ownItems: Map<string, number>; ownPrivate: number }>();
  const part = (u: string) => {
    let x = parts.get(u);
    if (!x) { x = { everyone: 0, some: 0, own: 0, ownItems: new Map(), ownPrivate: 0 }; parts.set(u, x); }
    return x;
  };
  const addPart = (u: string, people: number, v: number, label?: string | null, masked?: boolean) => {
    const x = part(u);
    if (people <= 1) {
      x.own += v;
      if (masked) x.ownPrivate += v;
      else if (label) x.ownItems.set(label, (x.ownItems.get(label) ?? 0) + v);
    } else if (people >= memberCount) x.everyone += v;
    else x.some += v;
  };

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
    const itemsSum = items.reduce((a, it) => a + it.lineTotal, 0);
    if (items.length && itemsSum > 0) {
      const scale = amt / itemsSum; // fees and discounts follow the items
      for (const it of items) {
        const n = it.sharedBy.length;
        if (!n) continue;
        for (const u of it.sharedBy) addPart(u, n, (it.lineTotal * scale) / n, itemKind(it) ?? it.name, it.masked);
      }
    } else {
      const inIt = e.splits.filter((x) => num(x.shareAmount) > 0.004);
      for (const x of inIt) addPart(x.userId, inIt.length, num(x.shareAmount), clip(e.description, 30));
    }
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
    L.push("", "WHY SHARES DIFFER (each person's share = whole-group items + items shared by some + their OWN items; fees follow the items; about, to the rupee):");
    L.push("A share depends ONLY on what a person is in. Who PAID never changes anyone's share; paying only changes balances.");
    for (const m of members) {
      const x = parts.get(m.id);
      if (!x) continue;
      const tot = x.everyone + x.some + x.own;
      if (tot < 0.5) continue;
      const top = [...x.ownItems].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${inr(v)}`).join(", ");
      L.push(`- ${nameOf(m.id)}: share ${inr(tot)} = whole group ${inr(x.everyone)} + shared with some ${inr(x.some)} + own items ${inr(x.own)}` +
        (top ? ` (biggest own: ${top}${x.ownPrivate >= 0.5 ? `, private items ${inr(x.ownPrivate)}` : ""})` : x.ownPrivate >= 0.5 ? ` (private items ${inr(x.ownPrivate)})` : ""));
    }
    L.push("BY CATEGORY: " + [...byCat].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => `${k} ${inr(v.total)} (${v.n}, your share ${inr(v.mine)})`).join("; "));
    if (byMonth.size > 1) L.push("BY MONTH: " + [...byMonth].sort().map(([k, v]) => `${k} ${inr(v.total)} (your share ${inr(v.mine)})`).join("; "));
  }

  // When the question is about items, the exact matching list above replaces this rough summary.
  if (!matchedAny && (kinds.size || privateRows)) {
    L.push("", "ITEMS BOUGHT, grouped by what they are (total price · your part · times bought):");
    const sorted = [...kinds].sort((a, b) => b[1].total - a[1].total);
    const maxKinds = budget < 2000 ? 20 : budget < 4000 ? 40 : 70; // smaller asks keep the priciest kinds
    for (const [k, v] of sorted.slice(0, maxKinds)) L.push(`- ${k}: ${inr(v.total)} · you ${inr(v.mine)} · ${v.rows}x`);
    if (sorted.length > maxKinds) L.push(`- …and ${sorted.length - maxKinds} more kinds of items (cheaper ones; the TOTALS above include them)`);
    if (privateRows) L.push(`- private items (only the person who had them can see what they were): ${inr(privateTotal)} in ${privateRows} rows`);
  }

  // ── Each expense, newest first, until the budget runs out ─────────────────
  L.push("", "EXPENSES (newest first; ref in brackets):");
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

  return { text: L.join("\n"), refs, items: matched };
}
