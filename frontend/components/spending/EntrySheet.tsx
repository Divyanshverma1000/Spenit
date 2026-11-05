"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Calendar, Loader2, Trash2, X } from "lucide-react";
import { CATEGORIES, dayStart, guessCategory, type Category } from "@/lib/quickAdd";
import { CATEGORY_META, dayOf } from "@/lib/spending";

const noSubscribe = () => () => {};

export interface EntryDraft {
  id?: string;
  description: string;
  amount: string;
  category: Category;
  /** YYYY-MM-DD */
  day: string;
}

const isoDay = (d: Date) => d.toLocaleDateString("en-CA");

/**
 * Add or edit a personal expense. Amount first (big, number keypad), then what it was
 * for (the category follows the name until you pick one yourself), then when.
 */
export default function EntrySheet({
  initial, onClose, onSave, onDelete,
}: {
  initial?: Partial<EntryDraft>;
  onClose: () => void;
  onSave: (d: { description: string; amount: number; category: Category; spentAt: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const today = isoDay(new Date());
  const yesterday = isoDay(dayStart(1));
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState<Category>(() => {
    if (initial?.category) return initial.category;
    const g = initial?.description ? guessCategory(initial.description) : "Misc";
    return g === "Misc" ? "Food" : g;
  });
  const [picked, setPicked] = useState(!!initial?.id); // chose a category by hand
  const [day, setDay] = useState(initial?.day ?? today);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const editing = !!initial?.id;

  useEffect(() => { if (!editing) setTimeout(() => amountRef.current?.focus(), 150); }, [editing]);

  const n = Number(amount.replace(/,/g, ""));
  const valid = n > 0 && n <= 10_000_000 && description.trim().length > 0;

  async function save() {
    if (!valid) return;
    setBusy("save");
    setError(null);
    try {
      // Noon on the chosen day, so the date never flips with time zones.
      await onSave({ description: description.trim(), amount: Math.round(n * 100) / 100, category, spentAt: new Date(`${day}T12:00:00`).toISOString() });
    } catch (err) {
      setError((err as Error).message || "Couldn't save. Check your connection.");
      setBusy(null);
    }
  }

  if (!isClient) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={editing ? "Edit expense" : "Add expense"}
        className="w-full max-w-md bg-[var(--paper)] rounded-t-[28px] max-h-[92dvh] flex flex-col"
      >
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <p className="font-bold text-[17px]">{editing ? "Edit expense" : "Add expense"}</p>
          <button onClick={onClose} className="p-1.5 -mr-1.5 text-[var(--text-muted)]" aria-label="Close"><X size={20} /></button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="px-5 pb-3 overflow-y-auto flex-1">
          {/* Amount, big */}
          <label className="flex items-baseline justify-center gap-1 py-4">
            <span className="text-[34px] font-bold text-[var(--text-muted)]">₹</span>
            <input
              ref={amountRef}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
              inputMode="decimal"
              placeholder="0"
              aria-label="Amount"
              style={{ width: `${Math.min(Math.max(amount.length, 1), 10) + 0.6}ch` }}
              className="max-w-[75%] bg-transparent text-left text-[46px] font-black tabular-nums tracking-tight text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none"
            />
          </label>

          {/* What for */}
          <input
            value={description}
            onChange={(e) => {
              const v = e.target.value.slice(0, 80);
              setDescription(v);
              // The category follows the name until you pick one yourself.
              if (!picked) { const g = guessCategory(v); if (g !== "Misc") setCategory(g); }
            }}
            placeholder="What was it for?"
            aria-label="What was it for"
            className="w-full px-4 py-3.5 rounded-[16px] bg-[var(--paper-dim)] text-[16px] font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-muted)] placeholder:font-medium focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)]"
          />

          {/* Category */}
          <p className="mt-4 mb-2 text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Category</p>
          <div className="grid grid-cols-5 gap-2">
            {CATEGORIES.map((c) => {
              const m = CATEGORY_META[c];
              const on = c === category;
              const Icon = m.icon;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setCategory(c); setPicked(true); }}
                  aria-pressed={on}
                  className={`flex flex-col items-center gap-1 py-2 rounded-[14px] border-2 transition-colors ${on ? "" : "border-transparent"}`}
                  style={on ? { borderColor: m.tint, backgroundColor: `${m.tint}14` } : undefined}
                >
                  <span className="w-9 h-9 rounded-[12px] flex items-center justify-center" style={{ backgroundColor: `${m.tint}1F`, color: m.tint }}>
                    <Icon size={18} strokeWidth={2.2} />
                  </span>
                  <span className={`text-[10.5px] font-semibold leading-tight text-center ${on ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>{m.label}</span>
                </button>
              );
            })}
          </div>

          {/* When */}
          <p className="mt-4 mb-2 text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">When</p>
          <div className="flex gap-2">
            {[["Today", today], ["Yesterday", yesterday]].map(([label, d]) => (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                className={`px-4 py-2 rounded-full text-[13px] font-bold border ${day === d ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}
              >
                {label}
              </button>
            ))}
            <label className={`relative flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-bold border cursor-pointer ${day !== today && day !== yesterday ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}>
              <Calendar size={14} />
              {day !== today && day !== yesterday ? new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Pick date"}
              <input
                type="date"
                value={day}
                max={today}
                onChange={(e) => e.target.value && setDay(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
                aria-label="Pick a date"
              />
            </label>
          </div>

          {error && <p role="alert" className="mt-3 text-[13px] font-medium text-[var(--negative)]">{error}</p>}
          <button type="submit" className="hidden" />
        </form>

        <div className="px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] border-t border-[var(--hairline)] flex gap-3">
          {editing && onDelete ? (
            <button
              onClick={async () => { setBusy("delete"); await onDelete().catch(() => setBusy(null)); }}
              disabled={busy !== null}
              className="w-14 rounded-[16px] bg-[#F43F5E]/10 text-[#E11D48] flex items-center justify-center"
              aria-label="Delete"
            >
              {busy === "delete" ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
            </button>
          ) : (
            <button onClick={onClose} className="px-5 py-3.5 rounded-[16px] bg-[var(--paper-dim)] font-bold text-[15px] text-[var(--text-secondary)]">Cancel</button>
          )}
          <button
            onClick={() => void save()}
            disabled={!valid || busy !== null}
            className="flex-1 py-3.5 rounded-[16px] bg-[var(--accent)] text-white font-bold text-[15px] disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {busy === "save" && <Loader2 size={16} className="animate-spin" />}
            {editing ? "Save changes" : n > 0 ? `Add ₹${n.toLocaleString("en-IN")}` : "Add"}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

/** An existing entry as a draft for the sheet. */
export const draftFrom = (e: { id: string; description: string; amount: number; category: string; at: string }): EntryDraft => ({
  id: e.id,
  description: e.description,
  amount: String(e.amount),
  category: (CATEGORIES as readonly string[]).includes(e.category) ? (e.category as Category) : "Misc",
  day: dayOf(e.at),
});
