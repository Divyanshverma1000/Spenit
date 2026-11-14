import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { billSummary, readBill } from "@/lib/billDetails";
import { personalOwner } from "@/lib/groupSpend";
import { Lock } from "lucide-react";

export interface Expense {
  id: string;
  description: string;
  amount: string;
  currency: string;
  splitType: string;
  createdAt: string;
  category?: string;
  /** true while the expense is queued locally and not yet saved on the server */
  pending?: boolean;
  /** set when the expense was changed after it was created */
  editedAt?: string | null;
  /** specific items saved with the expense (used by Repeat) */
  receiptData?: unknown;
  payers: { userId: string; name: string; amountPaid: string }[];
  splits: { userId: string; name: string; shareAmount: string }[];
}

export function ExpenseRow({ expense, onClick }: { expense: Expense; onClick?: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const formattedDate = new Date(expense.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const payerNames = expense.payers.map(p => p.name).join(", ");
  // Imported orders: a few words on what was in it, and how many items.
  const summary = billSummary(expense.receiptData);
  const itemCount = summary ? readBill(expense.receiptData)?.items.length ?? 0 : 0;
  // One person's own bill: nobody else owes for it.
  const owner = personalOwner(expense);
  const ownerName = owner ? owner.name.split(" ")[0] : null;

  const handleTap = () => {
    if (onClick) {
      onClick(); // Open full modal if provided
    } else {
      setExpanded(!expanded); // Or just expand inline
    }
  };

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={handleTap}
      className="w-full text-left bg-white p-4 flex flex-col hover:bg-[var(--paper-dim)] transition-colors active:bg-[var(--border-dark)] outline-none"
    >
      <div className="flex items-center gap-3 w-full">
        <div className="flex-shrink-0">
          <CategoryIcon category={expense.category ?? null} />
        </div>
        
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex justify-between items-start w-full">
            <span className="text-[16px] font-bold text-[var(--text-primary)] truncate tracking-tight">{expense.description}</span>
            <span className="text-[16px] font-bold text-[var(--text-primary)] tabular-nums tracking-tight">₹{parseFloat(expense.amount).toFixed(2)}</span>
          </div>
          
          {summary && (
            <p className="text-[12px] leading-[16px] text-[var(--text-muted)] truncate mt-px" title={summary}>{summary}</p>
          )}

          <div className="flex justify-between items-center w-full mt-0.5">
            <div className="text-[13px] text-[var(--text-secondary)] truncate flex items-center gap-1.5">
              <span>{formattedDate}</span>
              <span className="w-1 h-1 rounded-full bg-[var(--border-dark)]"></span>
              <span>{payerNames} paid</span>
            </div>
            {ownerName ? (
              <span className="text-[11px] font-bold text-[var(--text-secondary)] px-2 py-0.5 rounded-[8px] bg-[var(--paper-dim)] whitespace-nowrap flex-shrink-0 flex items-center gap-1" title="Only this person's: nobody else owes for it">
                <Lock size={10} strokeWidth={2.6} /> Just {ownerName}
              </span>
            ) : summary ? (
              <span className="text-[11px] font-semibold text-[var(--text-secondary)] px-2 py-0.5 rounded-[8px] bg-[var(--paper-dim)] whitespace-nowrap flex-shrink-0">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
            ) : (
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)] px-2 py-0.5 rounded-[8px] bg-[var(--accent-subtle)]">
                {expense.splitType}
              </span>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0, marginTop: 0 }}
            animate={{ height: "auto", opacity: 1, marginTop: 12 }}
            exit={{ height: 0, opacity: 0, marginTop: 0 }}
            className="overflow-hidden w-full pl-11 pr-2"
          >
            <div className="pt-3 border-t border-[var(--hairline)] flex flex-col gap-2">
              <span className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Shared among</span>
              <div className="flex flex-wrap gap-1.5">
                {expense.splits.map((s) => (
                  <span
                    key={s.userId}
                    className="text-[12px] px-2 py-1 rounded-[10px] bg-[var(--paper-dim)] text-[var(--text-primary)] font-medium border border-[var(--hairline)]"
                  >
                    {s.name} <span className="text-[var(--text-secondary)]">₹{parseFloat(s.shareAmount).toFixed(0)}</span>
                  </span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
