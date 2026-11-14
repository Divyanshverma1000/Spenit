/**
 * expenseText.ts — the safety net around "Cab 128 between me and Suryansh".
 *
 * The model reads the sentence; this file makes sure the parts people notice are right:
 *   - names: a person can be typed as their group nickname ("Shan"), real name ("Suryansh"),
 *     first name or username. Anyone named in the sentence is found, whichever name was used.
 *   - who shares it: "between Suryansh and me", "with Rahul", "me and Aman" → exactly those.
 *   - category: a cab is Travel, dinner is Food, rent is Stay…, when the model left it blank or Misc.
 * Pure; tested in expenseText.test.ts.
 */

export interface NamedMember { id: string; name: string; realName?: string | null; username?: string | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@]+/g, " ").trim();

/** Every name a member can be called by, lowercase. */
export function aliasesOf(m: NamedMember): string[] {
  const out = new Set<string>();
  for (const n of [m.name, m.realName]) {
    if (!n) continue;
    const full = norm(n);
    if (full) out.add(full);
    const first = full.split(" ")[0];
    if (first && first.length >= 3) out.add(first);
  }
  if (m.username && !m.username.startsWith("deleted_") && !/^[0-9a-f]{20,}$/.test(m.username)) out.add(norm(m.username));
  return [...out].filter((a) => a.length >= 2);
}

/**
 * Members named in the text (not "me"), by any of their names. A first name shared by two
 * people counts for neither (the model or the person must pick).
 */
export function membersNamedIn(text: string, members: NamedMember[], meId: string): string[] {
  const t = ` ${norm(text)} `;
  const hits = new Map<string, Set<string>>(); // alias → member ids
  for (const m of members) {
    if (m.id === meId) continue;
    for (const a of aliasesOf(m)) {
      if (t.includes(` ${a} `) || t.includes(` ${a}s `) || t.includes(` @${a} `)) {
        const s = hits.get(a) ?? new Set();
        s.add(m.id);
        hits.set(a, s);
      }
    }
  }
  const out = new Set<string>();
  for (const ids of hits.values()) if (ids.size === 1) out.add([...ids][0]);
  return [...out];
}

const ME = /\b(me|i|myself|mine|my)\b/;

/**
 * Who shares it, when the sentence says so plainly: "between X and me", "with X",
 * "me and X", "X and I". null = the sentence doesn't say (keep the model's answer).
 */
export function sharersFromText(text: string, members: NamedMember[], meId: string): string[] | null {
  const t = norm(text);
  if (/\b(everyone|everybody|all of us|whole group|all)\b/.test(t) && !/\bexcept\b/.test(t)) return null;
  if (/\b(except|without|excluding|not)\b/.test(t)) return null;
  if (/\b(only me|just me|i alone|only i|for me|myself only)\b/.test(t)) return [meId];
  const named = membersNamedIn(text, members, meId);
  if (named.length === 0) return null;
  const splitCue = /\b(between|among|amongst|with|split|shared|share)\b/.test(t) || /\b(me and|and me|and i|i and)\b/.test(t);
  if (!splitCue) return null;
  // "with Aman": whoever paid (me unless the sentence says otherwise) is in too.
  const payer = payerFromText(text, members, meId) ?? meId;
  const out = new Set(named);
  if (ME.test(t.replace(/\bi paid\b|\bpaid by me\b/, ""))) out.add(meId);
  if (/\bwith\b/.test(t)) out.add(payer);
  return [...out].sort((a, b) => (a === meId ? -1 : b === meId ? 1 : 0));
}

/** "Rahul paid" / "paid by Rahul" → Rahul; "I paid" → me; null = not said. */
export function payerFromText(text: string, members: NamedMember[], meId: string): string | null {
  const t = norm(text);
  if (/\b(i paid|paid by me|i have paid|i ve paid|my treat|on me)\b/.test(t)) return meId;
  for (const m of members) {
    if (m.id === meId) continue;
    for (const a of aliasesOf(m)) {
      if (new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (paid|has paid|ne diya|gave)\\b`).test(t) || new RegExp(`\\bpaid by ${a}\\b`).test(t)) return m.id;
    }
  }
  return null;
}

const CATEGORY_WORDS: [string, string[]][] = [
  ["Travel", ["cab", "uber", "ola", "rapido", "auto", "taxi", "metro", "train", "flight", "bus", "toll", "parking", "travel", "ticket", "irctc", "bike ride", "ride"]],
  ["Fuel", ["petrol", "diesel", "fuel", "cng", "gas station"]],
  ["Food", ["dinner", "lunch", "breakfast", "snacks", "food", "pizza", "burger", "biryani", "zomato", "swiggy", "cafe", "coffee", "chai", "tea", "restaurant", "dhaba", "drinks", "beer", "maggi", "momos", "dessert", "ice cream", "cake"]],
  ["Stay", ["hotel", "rent", "airbnb", "hostel", "pg", "stay", "room", "oyo"]],
  ["Utilities", ["electricity", "wifi", "wi fi", "internet", "recharge", "water bill", "gas bill", "maid", "cook", "maintenance", "bill"]],
  ["Shopping", ["shopping", "clothes", "amazon", "flipkart", "myntra", "shoes", "gift"]],
  ["Medical", ["medicine", "doctor", "pharmacy", "hospital", "chemist", "tablets"]],
  ["Entertainment", ["movie", "netflix", "concert", "game", "bowling", "party", "club", "spotify", "match"]],
];

/** A category from plain words in the sentence, or null. */
export function categoryFromText(text: string): string | null {
  const t = ` ${norm(text)} `;
  for (const [cat, words] of CATEGORY_WORDS) if (words.some((w) => t.includes(` ${w} `) || t.includes(` ${w}s `))) return cat;
  return null;
}
