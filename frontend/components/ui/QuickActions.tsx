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
    <div className="flex gap-4">
      {actions.map((action, idx) => {
        const content = (
          <motion.div 
            whileTap={{ scale: 0.95 }}
            className="flex flex-col items-center justify-center gap-2 p-4 bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-[rgba(0,0,0,0.02)] flex-1 w-full"
          >
            <div className={`h-12 w-12 rounded-full flex items-center justify-center ${action.accent ? "bg-[var(--accent)] text-white shadow-[0_4px_14px_rgba(245,158,11,0.3)]" : "bg-[var(--paper-dim)] text-[var(--accent)]"}`}>
              {action.icon}
            </div>
            <span className="text-[13px] font-semibold text-[var(--text-primary)] text-center tracking-tight">
              {action.label}
            </span>
          </motion.div>
        );

        if (action.href) {
          return (
            <Link key={idx} href={action.href} className="flex-1 outline-none">
              {content}
            </Link>
          );
        }

        return (
          <button key={idx} onClick={action.onClick} className="flex-1 outline-none">
            {content}
          </button>
        );
      })}
    </div>
  );
}
