/** WhatsApp-first sharing helpers. */

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function openWhatsApp(text: string) {
  if (typeof window === "undefined") return;
  window.open(whatsappUrl(text), "_blank", "noopener,noreferrer");
}

export const rupees = (v: string | number) =>
  `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** "Rahul owes you ₹320" style message for one person, with their personal pay link. */
export function oweMessage(opts: { name: string; groupName: string; amount: string; url: string }) {
  return (
    `Hi ${opts.name}! You owe ${rupees(opts.amount)} in "${opts.groupName}". ` +
    `See the details and pay in one tap: ${opts.url}`
  );
}

/** Whole-group "who pays whom" summary. */
export function groupSummaryMessage(opts: {
  groupName: string;
  transfers: { fromName: string; toName: string; amount: string }[];
  joinUrl?: string;
}) {
  const lines =
    opts.transfers.length === 0
      ? ["Everyone is settled up."]
      : opts.transfers.map((t) => `• ${t.fromName} → ${t.toName}: ${rupees(t.amount)}`);
  return [
    `*${opts.groupName}*: who pays whom`,
    ...lines,
    ...(opts.joinUrl ? ["", `Open in Spenit: ${opts.joinUrl}`] : []),
  ].join("\n");
}

/** Friendly nudge for someone who owes you money (no link needed, works for anyone). */
export function remindMessage(opts: { name: string; groupName: string; amount: string }) {
  return `Hi ${opts.name}! Friendly reminder: you owe me ${rupees(opts.amount)} for "${opts.groupName}". You can pay via UPI. Thanks!`;
}
