"use client";

import { useState } from "react";
import { EXPENSE_CATEGORIES, CATEGORY_EMOJI, type ExpenseCategory } from "@/hooks/types/ai";

interface CategoryBadgeProps {
  value: ExpenseCategory | null;
  onChange: (cat: ExpenseCategory | null) => void;
  /** If true, renders as a compact pill; otherwise shows a full selector */
  compact?: boolean;
}

/**
 * CategoryBadge — shows the AI-inferred category as an editable pill.
 * The user can tap it to change the category before confirming.
 */
export default function CategoryBadge({ value, onChange, compact = false }: CategoryBadgeProps) {
  const [open, setOpen] = useState(false);

  const emoji = value ? CATEGORY_EMOJI[value] : "📦";
  const label = value || "Misc";

  if (compact) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-full bg-violet-500/15 border border-violet-500/30 px-3 py-1 text-xs font-medium text-violet-300 hover:bg-violet-500/25 transition-colors"
        >
          <span>{emoji}</span>
          <span>{label}</span>
          <svg className="h-3 w-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 top-full mt-1 z-40 w-52 rounded-2xl border border-white/10 bg-[#1a1a2e] shadow-xl p-2 grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                className={`flex flex-col items-center gap-0.5 rounded-xl p-2 text-xs transition-colors ${!value ? "bg-violet-500/20 text-violet-300" : "text-slate-400 hover:bg-white/5"}`}
              >
                <span>📦</span>
                <span>Misc</span>
              </button>
              {EXPENSE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => { onChange(cat); setOpen(false); }}
                  className={`flex flex-col items-center gap-0.5 rounded-xl p-2 text-xs transition-colors ${value === cat ? "bg-violet-500/20 text-violet-300" : "text-slate-400 hover:bg-white/5"}`}
                >
                  <span>{CATEGORY_EMOJI[cat]}</span>
                  <span>{cat}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // Full selector (used in the confirm card form)
  return (
    <div className="grid grid-cols-5 gap-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`flex flex-col items-center gap-1 rounded-xl py-2 text-xs transition-colors border ${!value ? "border-violet-500/50 bg-violet-500/15 text-violet-300" : "border-white/5 text-slate-500 hover:bg-white/5"}`}
      >
        <span>📦</span>
        <span>Misc</span>
      </button>
      {EXPENSE_CATEGORIES.filter(c => c !== "Misc").map((cat) => (
        <button
          key={cat}
          type="button"
          onClick={() => onChange(cat)}
          className={`flex flex-col items-center gap-1 rounded-xl py-2 text-xs transition-colors border ${value === cat ? "border-violet-500/50 bg-violet-500/15 text-violet-300" : "border-white/5 text-slate-500 hover:bg-white/5"}`}
        >
          <span>{CATEGORY_EMOJI[cat]}</span>
          <span>{cat}</span>
        </button>
      ))}
    </div>
  );
}
