import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { BalanceAmount } from "@/components/ui/BalanceAmount";

export interface Expense {
  id: string;
  description: string;
  amount: string;
  currency: string;
  splitType: string;
  createdAt: string;
  category?: string;
  payers: { userId: string; name: string; amountPaid: string }[];
  splits: { userId: string; name: string; shareAmount: string }[];
}

export function ExpenseRow({ expense, onClick }: { expense: Expense; onClick?: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const formattedDate = new Date(expense.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const payerNames = expense.payers.map(p => p.name).join(", ");

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
          
          <div className="flex justify-between items-center w-full mt-0.5">
            <div className="text-[13px] text-[var(--text-secondary)] truncate flex items-center gap-1.5">
              <span>{formattedDate}</span>
              <span className="w-1 h-1 rounded-full bg-[var(--border-dark)]"></span>
              <span>{payerNames} paid</span>
            </div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)] px-2 py-0.5 rounded-[8px] bg-[var(--accent-subtle)]">
              {expense.splitType}
            </span>
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
            <div className="pt-3 border-t border-[rgba(0,0,0,0.03)] flex flex-col gap-2">
              <span className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Shared among</span>
              <div className="flex flex-wrap gap-1.5">
                {expense.splits.map((s) => (
                  <span
                    key={s.userId}
                    className="text-[12px] px-2 py-1 rounded-[10px] bg-[var(--paper-dim)] text-[var(--text-primary)] font-medium border border-[rgba(0,0,0,0.03)]"
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
