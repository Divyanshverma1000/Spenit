import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";

export interface QuickActionItem {
  icon: React.ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
  accent?: boolean;
}

export function QuickActions({ actions }: { actions: QuickActionItem[] }) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {actions.map((action, idx) => {
        const content = (
          <motion.div 
            whileTap={{ scale: 0.92 }}
            className="flex flex-col items-center justify-center gap-2 p-3 bg-white rounded-[16px] shadow-[0_2px_10px_rgba(0,0,0,0.02)] border border-[rgba(0,0,0,0.03)] h-full w-full aspect-square"
          >
            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${action.accent ? "bg-[var(--accent)] text-white shadow-[0_4px_14px_rgba(245,158,11,0.3)]" : "bg-[var(--ink)] text-[var(--accent)]"}`}>
              {action.icon}
            </div>
            <span className="text-[11px] font-semibold text-[var(--text-primary)] text-center leading-tight">
              {action.label}
            </span>
          </motion.div>
        );

        if (action.href) {
          return (
            <Link key={idx} href={action.href} className="outline-none block">
              {content}
            </Link>
          );
        }

        return (
          <button key={idx} onClick={action.onClick} className="outline-none block w-full">
            {content}
          </button>
        );
      })}
    </div>
  );
}
