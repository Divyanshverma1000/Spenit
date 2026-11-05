import React from 'react';

interface EmptyStateProps {
  type: 'no-groups' | 'no-expenses' | 'all-settled';
  title: string;
  description: string;
  action?: { label: string; href: string; } | React.ReactNode;
}

import { motion } from 'framer-motion';

/** Premium 3D illustrations (public/illustrations, generated from one sheet in images/empty-states-sheet.png). */
const ART: Record<EmptyStateProps["type"], string> = {
  "no-groups": "/illustrations/no-groups.webp",
  "no-expenses": "/illustrations/no-expenses.webp",
  "all-settled": "/illustrations/all-settled.webp",
};

function Illustration({ type }: { type: EmptyStateProps["type"] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 20 }}
      className="relative mx-auto mb-6 w-40 h-40"
    >
      {/* soft amber glow behind the tile */}
      <div aria-hidden className="absolute inset-4 rounded-full bg-[var(--accent)] opacity-20 blur-2xl" />
      <motion.img
        src={ART[type]}
        alt=""
        width={160}
        height={160}
        draggable={false}
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="relative w-40 h-40 rounded-[28px] shadow-[0_18px_40px_-12px_rgba(180,110,20,0.35)] select-none"
      />
    </motion.div>
  );
}

export function EmptyState({ type, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8">
      <Illustration type={type} />
      <h3 className="font-[family-name:var(--font-display)] text-xl text-[var(--text-primary)] mb-2">
        {title}
      </h3>
      <p className="font-[family-name:var(--font-body)] text-sm text-[var(--text-secondary)] mb-6 max-w-[250px]">
        {description}
      </p>
      {action && (
        typeof action === 'object' && action !== null && 'label' in action && 'href' in action ? (
          <a 
            href={(action as any).href}
            className="btn-primary px-6 py-2 rounded-[var(--radius-md)] font-[family-name:var(--font-body)] font-medium bg-[var(--accent)] text-white"
          >
            {(action as any).label}
          </a>
        ) : (
          <>{action as React.ReactNode}</>
        )
      )}
    </div>
  );
}
