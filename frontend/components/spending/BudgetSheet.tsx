"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Loader2, Target, X } from "lucide-react";
import { inr } from "@/lib/spending";

const noSubscribe = () => () => {};

/** Set, change or remove the monthly budget. Suggests one from last month. */
export default function BudgetSheet({
  current, lastMonth, onClose, onSave,
}: {
  current: number | null;
  lastMonth: number;
  onClose: () => void;
  onSave: (amount: number | null) => Promise<void>;
}) {
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [value, setValue] = useState(current ? String(current) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(value.replace(/,/g, ""));
  const suggestion = lastMonth > 0 ? Math.ceil((lastMonth * 0.9) / 500) * 500 : null;

  async function save(amount: number | null) {
    setBusy(true);
    setError(null);
    try { await onSave(amount); } catch (err) { setError((err as Error).message || "Couldn't save"); setBusy(false); }
  }

  if (!isClient) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Monthly budget"
        className="w-full max-w-md bg-[var(--paper)] rounded-t-[28px]"
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center flex-shrink-0"><Target size={19} /></span>
            <div className="flex-1">
              <p className="font-bold text-[17px]">Monthly budget</p>
              <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">Everything you spend counts, including your share of group bills. Spenit tells you if you&apos;re running ahead.</p>
            </div>
            <button onClick={onClose} className="p-1.5 text-[var(--text-muted)]" aria-label="Close"><X size={20} /></button>
          </div>
          <label className="mt-4 flex items-center gap-2 px-4 py-3.5 rounded-[16px] bg-[var(--paper-dim)] focus-within:ring-2 focus-within:ring-[var(--accent-subtle)]">
            <span className="text-[20px] font-bold text-[var(--text-muted)]">₹</span>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d,]/g, ""))}
              inputMode="numeric"
              placeholder="15,000"
              aria-label="Budget per month"
              className="flex-1 min-w-0 bg-transparent text-[22px] font-black tabular-nums focus:outline-none"
            />
            <span className="text-[13px] text-[var(--text-muted)]">a month</span>
          </label>
          {suggestion && !value && (
            <button onClick={() => setValue(String(suggestion))} className="mt-2 text-[13px] font-semibold text-[var(--accent)]">
              Try {inr(suggestion)}: 10% under last month
            </button>
          )}
          {error && <p role="alert" className="mt-2 text-[13px] font-medium text-[var(--negative)]">{error}</p>}
        </div>
        <div className="px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] border-t border-[var(--hairline)] flex gap-3">
          {current ? (
            <button onClick={() => void save(null)} disabled={busy} className="px-5 py-3.5 rounded-[16px] bg-[var(--paper-dim)] font-bold text-[15px] text-[var(--text-secondary)]">Remove</button>
          ) : (
            <button onClick={onClose} className="px-5 py-3.5 rounded-[16px] bg-[var(--paper-dim)] font-bold text-[15px] text-[var(--text-secondary)]">Cancel</button>
          )}
          <button
            onClick={() => void save(n)}
            disabled={!(n > 0) || busy}
            className="flex-1 py-3.5 rounded-[16px] bg-[var(--accent)] text-white font-bold text-[15px] disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={16} className="animate-spin" />} Save budget
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
