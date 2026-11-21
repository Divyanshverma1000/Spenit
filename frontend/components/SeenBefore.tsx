"use client";

import { Check, History } from "lucide-react";
import { seenWords, type SeenMatch } from "@/lib/billPrint";

/**
 * "You may have added this already": when and where the earlier bill was added, and two
 * answers. Nothing is thrown away on its own; the same items can be a genuine reorder.
 */
export default function SeenBefore({
  match, decision, onSkip, onKeep, skipLabel = "Skip it", keepLabel = "It's a new order", className = "",
}: {
  match: SeenMatch;
  /** null = not answered yet */
  decision: "skip" | "keep" | null;
  onSkip: () => void;
  onKeep: () => void;
  skipLabel?: string;
  keepLabel?: string;
  className?: string;
}) {
  const w = seenWords(match);
  const pill = (on: boolean) =>
    `flex-1 h-10 rounded-[12px] text-[13px] font-bold border-2 flex items-center justify-center gap-1.5 transition-colors ${
      on ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--text-primary)]" : "border-[var(--hairline)] bg-[var(--paper)] text-[var(--text-secondary)]"
    }`;
  return (
    <div
      role="status"
      className={`rounded-[16px] border-[1.5px] p-3 ${className}`}
      style={{ borderColor: decision ? "var(--hairline)" : "color-mix(in srgb, var(--warn) 60%, transparent)", background: "color-mix(in srgb, var(--warn) 9%, var(--paper))" }}
    >
      <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-[var(--text-primary)]">
        <History size={15} className="text-[var(--warn)] flex-shrink-0" aria-hidden /> {w.title}
      </p>
      <p className="mt-1 text-[12.5px] leading-snug text-[var(--text-secondary)]">{w.detail}</p>
      <p className="mt-1 text-[12px] leading-snug text-[var(--text-muted)]">{w.hint}</p>
      <div className="mt-2.5 flex gap-2" role="radiogroup" aria-label="Is this the same bill?">
        <button type="button" role="radio" aria-checked={decision === "skip"} onClick={onSkip} className={pill(decision === "skip")}>
          {decision === "skip" && <Check size={14} strokeWidth={2.8} />} {skipLabel}
        </button>
        <button type="button" role="radio" aria-checked={decision === "keep"} onClick={onKeep} className={pill(decision === "keep")}>
          {decision === "keep" && <Check size={14} strokeWidth={2.8} />} {keepLabel}
        </button>
      </div>
    </div>
  );
}
