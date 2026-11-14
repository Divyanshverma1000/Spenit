/**
 * chatItems.ts — item answers in the group chat are written here, not by the model:
 * the model picks which matching rows count, this writes the list and the total. Pure.
 */
const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * The model's 1–2 sentence lead, then the exact items it picked and their total, written
 * here from the real rows. Any list or total the model wrote anyway is dropped.
 */
export function answerWithItems(lead: string, rows: { name: string; qty: number | null; price: number; mine: number }[]): string {
  const intro = lead.split(/\n\s*(?:[-*•]|\d+\.)\s/)[0].replace(/\s*(total|in all)[^.]*₹[\d,.]+[^.]*\.?\s*$/i, "").trim();
  const total = rows.reduce((a, r) => a + r.price, 0);
  const mine = rows.reduce((a, r) => a + r.mine, 0);
  const list = rows.map((r) => `- ${r.name}${r.qty && r.qty > 1 ? ` x${r.qty}` : ""}: ${money(r.price)}${Math.abs(r.mine - r.price) > 0.004 ? ` (you ${money(r.mine)})` : ""}`);
  const sum = `**${rows.length} ${rows.length === 1 ? "item" : "items"}, ${money(Math.round(total * 100) / 100)}**` +
    (Math.abs(mine - total) > 0.004 ? ` · your part **${money(Math.round(mine * 100) / 100)}**` : "") + " (item prices, before delivery fees)";
  return `${intro ? intro + "\n\n" : ""}${list.join("\n")}\n\n${sum}`;
}

