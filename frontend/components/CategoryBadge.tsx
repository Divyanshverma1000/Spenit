"use client";

import { useState } from "react";
import { EXPENSE_CATEGORIES, CATEGORY_ICONS, type ExpenseCategory } from "@/hooks/types/ai";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { ChevronDown, Package } from "lucide-react";

interface CategoryBadgeProps {
  value: ExpenseCategory | null;
  onChange: (cat: ExpenseCategory | null) => void;
  /** If true, renders as a compact pill; otherwise shows a full selector */
  compact?: boolean;
}

export default function CategoryBadge({ value, onChange, compact = false }: CategoryBadgeProps) {
  const [open, setOpen] = useState(false);

  const label = value || "Misc";

  if (compact) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--paper-dim)] border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--paper)] transition-colors"
        >
          {value ? <CategoryIcon category={value} /> : <Package className="h-4 w-4" strokeWidth={1.5} />}
          <span>{label}</span>
          <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={1.5} />
        </button>

        {open && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 top-full mt-1 z-40 w-52 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--paper)] shadow-xl p-2 grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                className={`flex flex-col items-center gap-1 rounded-[var(--radius-sm)] p-2 text-xs transition-colors ${!value ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--paper-dim)]"}`}
              >
                <Package className="h-4 w-4" strokeWidth={1.5} />
                <span>Misc</span>
              </button>
              {EXPENSE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => { onChange(cat); setOpen(false); }}
                  className={`flex flex-col items-center gap-1 rounded-[var(--radius-sm)] p-2 text-xs transition-colors ${value === cat ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--paper-dim)]"}`}
                >
                  <CategoryIcon category={cat} />
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
        className={`flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] py-2 text-xs transition-colors border ${!value ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--border)] bg-[var(--paper)] text-[var(--text-secondary)] hover:bg-[var(--paper-dim)]"}`}
      >
        <Package className="h-5 w-5" strokeWidth={1.5} />
        <span>Misc</span>
      </button>
      {EXPENSE_CATEGORIES.filter(c => c !== "Misc").map((cat) => (
        <button
          key={cat}
          type="button"
          onClick={() => onChange(cat)}
          className={`flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] py-2 text-xs transition-colors border ${value === cat ? "border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]" : "border-[var(--border)] bg-[var(--paper)] text-[var(--text-secondary)] hover:bg-[var(--paper-dim)]"}`}
        >
          <CategoryIcon category={cat} />
          <span>{cat}</span>
        </button>
      ))}
    </div>
  );
}
