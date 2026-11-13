"use client";

import { useState, useSyncExternalStore } from "react";
import { Info, MessageCircle, Receipt, UserPlus, Undo2 } from "lucide-react";
import { notice } from "@/lib/dialog";

const SEEN_KEY = "spenit-tip-add-people";
const noSubscribe = () => () => {};

function readSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}

const STEPS = [
  {
    Icon: UserPlus, tint: "#F59E0B",
    title: "Add their name",
    body: "Tap Add someone and type a name, like Rahul. They don't need the app yet.",
  },
  {
    Icon: Receipt, tint: "#10B981",
    title: "Split bills with them now",
    body: "They show up in every bill and in the balances, like anyone else in the group.",
  },
  {
    Icon: MessageCircle, tint: "#3B82F6",
    title: "Send their invite",
    body: "Tap the chat icon next to their name. When they open it, they pick \"I'm Rahul\" and everything you recorded becomes theirs.",
  },
] as const;

/** The explainer itself: also usable from anywhere with `showAddPeopleHelp()`. */
export function showAddPeopleHelp() {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode */ }
  void notice({
    title: "Add people before they join",
    confirmLabel: "Got it",
    body: (
      <div className="mt-3 space-y-3.5">
        {STEPS.map(({ Icon, tint, title, body }, i) => (
          <div key={title} className="flex items-start gap-3">
            <span className="relative w-10 h-10 rounded-[13px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${tint}1F`, color: tint }}>
              <Icon size={19} strokeWidth={2.3} />
              <span className="absolute -top-1.5 -left-1.5 w-[18px] h-[18px] rounded-full bg-[var(--paper)] border border-[var(--hairline)] text-[10.5px] font-extrabold text-[var(--text-primary)] flex items-center justify-center">{i + 1}</span>
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="font-bold text-[14.5px] text-[var(--text-primary)]">{title}</p>
              <p className="text-[13px] leading-snug">{body}</p>
            </div>
          </div>
        ))}
        <p className="flex items-start gap-2 pt-1 text-[12.5px] text-[var(--text-muted)]">
          <Undo2 size={14} className="flex-shrink-0 mt-0.5" />
          Picked the wrong name? They can tap Not me, or an admin can undo it. Nothing is lost.
        </p>
      </div>
    ),
  });
}

/**
 * The (i) next to MEMBERS. Until it's been opened once on this phone it glows and says
 * "How it works", so a first-time admin notices it; after that it's a quiet icon.
 */
export default function AddPeopleHelpButton({ highlight }: { highlight: boolean }) {
  const storedSeen = useSyncExternalStore(noSubscribe, readSeen, () => true);
  const [seenNow, setSeenNow] = useState(false);
  const glow = highlight && !storedSeen && !seenNow;

  return (
    <button
      onClick={() => { setSeenNow(true); showAddPeopleHelp(); }}
      aria-label="How adding people works"
      className={`relative flex items-center gap-1.5 rounded-full transition-colors ${
        glow ? "pl-1.5 pr-2.5 py-1 bg-[var(--accent-subtle)] text-[var(--accent)]" : "p-1 text-[var(--text-muted)]"
      }`}
    >
      <span className="relative flex">
        {glow && <span className="absolute inset-0 rounded-full bg-[var(--accent)] opacity-40 motion-safe:animate-ping" aria-hidden />}
        <Info size={16} strokeWidth={2.4} className="relative" />
      </span>
      {glow && <span className="text-[12px] font-bold whitespace-nowrap">How it works</span>}
    </button>
  );
}
