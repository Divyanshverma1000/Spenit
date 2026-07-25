import React from "react";
import { motion } from "framer-motion";

export function SettingsList({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="mb-6">
      {title && (
        <h3 className="text-[13px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2 ml-4">
          {title}
        </h3>
      )}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-white rounded-[24px] overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-[rgba(0,0,0,0.02)]"
      >
        <div className="flex flex-col divide-y divide-[var(--paper-dim)]">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
