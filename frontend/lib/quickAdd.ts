/**
 * quickAdd.ts — turn "chai 20", "uber 340 yesterday" or "₹1.2k rent" into an expense,
 * on the phone, instantly (no AI: free and works offline). Pure; tested in quickAdd.test.ts.
 */

export const CATEGORIES = ["Food", "Groceries", "Travel", "Shopping", "Stay", "Fuel", "Medical", "Utilities", "Entertainment", "Misc"] as const;
export type Category = (typeof CATEGORIES)[number];

const KEYWORDS: Record<Exclude<Category, "Misc">, string[]> = {
  Food: ["chai", "tea", "coffee", "lunch", "dinner", "breakfast", "snack", "snacks", "zomato", "swiggy", "pizza", "burger", "biryani", "maggi", "juice", "samosa", "dosa", "momos", "food", "cafe", "restaurant", "canteen", "mess", "tiffin", "icecream", "ice cream", "thali", "paratha", "sandwich", "starbucks", "dominos", "kfc", "mcdonalds"],
  Groceries: ["grocery", "groceries", "milk", "bread", "eggs", "vegetables", "veggies", "sabzi", "fruits", "blinkit", "zepto", "instamart", "bigbasket", "dmart", "kirana", "atta", "rice", "dal", "paneer", "curd"],
  Travel: ["uber", "ola", "rapido", "auto", "cab", "taxi", "metro", "bus", "train", "flight", "irctc", "ticket", "toll", "parking", "travel"],
  Fuel: ["petrol", "diesel", "fuel", "cng"],
  Shopping: ["amazon", "flipkart", "myntra", "meesho", "ajio", "clothes", "shirt", "jeans", "shoes", "gift", "shopping", "watch", "bag"],
  Stay: ["rent", "hotel", "pg", "hostel", "airbnb", "oyo", "stay"],
  Medical: ["medicine", "medicines", "pharmacy", "doctor", "hospital", "chemist", "tablets", "apollo", "medical", "clinic", "dentist"],
  Utilities: ["electricity", "wifi", "internet", "recharge", "mobile", "bill", "gas", "water", "dth", "jio", "airtel", "vi", "broadband", "laundry"],
  Entertainment: ["movie", "movies", "netflix", "spotify", "prime", "hotstar", "game", "games", "concert", "pvr", "inox", "party", "club", "bowling"],
};

/** Best category for a name ("Uber to office" → Travel), Misc when nothing matches. */
export function guessCategory(text: string): Category {
  const t = ` ${text.toLowerCase().replace(/[^a-z\s]/g, " ")} `;
  for (const [cat, words] of Object.entries(KEYWORDS) as [Category, string[]][]) {
    if (words.some((w) => t.includes(` ${w} `) || t.includes(` ${w}s `))) return cat;
  }
  return "Misc";
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export interface QuickEntry {
  description: string;
  amount: number;
  category: Category;
  /** 0 = today, 1 = yesterday, … */
  daysAgo: number;
}

/** Parse one line; null when there's no amount in it. */
export function parseQuickAdd(input: string, today = new Date()): QuickEntry | null {
  let text = ` ${input.trim()} `;
  if (!text.trim()) return null;

  // When: today / yesterday / a weekday ("last" optional)
  let daysAgo = 0;
  const when = text.match(/\s(today|yesterday|yday|(?:last\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|rsday)?)\s/i);
  if (when) {
    const w = when[1].toLowerCase();
    if (w === "yesterday" || w === "yday") daysAgo = 1;
    else if (w !== "today") {
      const short = (when[2] ?? "").toLowerCase().slice(0, 3);
      const target = WEEKDAYS.findIndex((d) => d.startsWith(short));
      const diff = (today.getDay() - target + 7) % 7;
      daysAgo = diff === 0 ? 7 : diff;
    }
    text = text.replace(when[0], " ");
  }

  // How much: 20 · ₹20 · rs 20 · 20rs · 1,200 · 1.5k · 340.50
  const m = text.match(/\s(?:₹|rs\.?\s?|inr\s?)?(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d{1,2})?)\s?(k)?(?:\s?(?:rs|₹|rupees|inr))?(?=\s)/i);
  if (!m) return null;
  let amount = parseFloat(m[1].replace(/,/g, ""));
  if (m[2]) amount *= 1000;
  amount = Math.round(amount * 100) / 100;
  if (!(amount > 0) || amount > 10_000_000) return null;
  text = text.replace(m[0], " ");

  const words = text.replace(/\s+/g, " ").trim().replace(/^(for|on|at)\s+/i, "");
  const category = guessCategory(words);
  const description = words ? words.charAt(0).toUpperCase() + words.slice(1, 80) : category === "Misc" ? "Expense" : category;
  return { description, amount, category, daysAgo };
}

/** A date at noon local time, `daysAgo` days back (noon avoids timezone edge flips). */
export function dayStart(daysAgo: number, from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d;
}
