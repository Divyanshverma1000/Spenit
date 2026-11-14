import React from "react";
import { motion } from "framer-motion";

interface SummaryItem {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  /** a small line under the value */
  sub?: React.ReactNode;
  onClick?: () => void;
}

export function SummaryGrid({ items }: { items: SummaryItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 mb-5">
      {items.map((item, idx) => (
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.05 }}
          role={item.onClick ? "button" : undefined}
          tabIndex={item.onClick ? 0 : undefined}
          onClick={item.onClick}
          onKeyDown={item.onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.onClick!(); } } : undefined}
          className={`bg-white rounded-[24px] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.04),0_2px_10px_rgba(0,0,0,0.02)] border border-[var(--hairline)] flex flex-col justify-between min-h-[88px] ${item.onClick ? "cursor-pointer active:scale-[0.98] transition-transform" : ""}`}
        >
          <span className="text-[12px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            {item.label}
          </span>
          <span className={`text-[20px] font-bold tabular-nums tracking-tight ${item.valueClassName || "text-[var(--text-primary)]"}`}>
            {item.value}
          </span>
          {item.sub && <span className="text-[11.5px] font-semibold text-[var(--text-secondary)] leading-tight -mt-0.5">{item.sub}</span>}
        </motion.div>
      ))}
    </div>
  );
}
