import React from 'react';

interface EmptyStateProps {
  type: 'no-groups' | 'no-expenses' | 'all-settled';
  title: string;
  description: string;
  action?: { label: string; href: string; } | React.ReactNode;
}

import { motion } from 'framer-motion';

function Illustration({ type }: { type: EmptyStateProps['type'] }) {
  if (type === 'no-groups') {
    return (
      <motion.svg width="100" height="100" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)] mx-auto mb-6">
        <motion.rect 
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.5, ease: "easeInOut" }}
          x="20" y="25" width="60" height="50" rx="8" 
        />
        <motion.path 
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1, delay: 0.8, ease: "easeInOut" }}
          d="M50 40v20" 
        />
        <motion.path 
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1, delay: 1, ease: "easeInOut" }}
          d="M40 50h20" 
        />
        <motion.circle 
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.15 }}
          transition={{ duration: 1.2, delay: 0.2 }}
          cx="50" cy="50" r="35" fill="currentColor" stroke="none" 
        />
      </motion.svg>
    );
  }
  if (type === 'no-expenses') {
    return (
      <motion.svg width="100" height="100" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)] mx-auto mb-6">
        <motion.path 
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.5, ease: "easeInOut" }}
          d="M30 15h40v70l-10-6.5-10 6.5-10-6.5-10 6.5V15z" 
        />
        <motion.path 
          initial={{ pathLength: 0, opacity: 0, x: -10 }}
          animate={{ pathLength: 1, opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          d="M45 40h15" 
        />
        <motion.path 
          initial={{ pathLength: 0, opacity: 0, x: -10 }}
          animate={{ pathLength: 1, opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 1 }}
          d="M45 55h15" 
        />
        <motion.circle 
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.15 }}
          transition={{ duration: 1.2, delay: 0.2 }}
          cx="50" cy="50" r="40" fill="currentColor" stroke="none" 
        />
      </motion.svg>
    );
  }
  if (type === 'all-settled') {
    return (
      <motion.svg width="100" height="100" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--positive)] mx-auto mb-6">
        <motion.circle 
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          cx="50" cy="50" r="35" 
        />
        <motion.path 
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
          d="M35 50l10 10 20-20" 
        />
        <motion.circle 
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 0.15 }}
          transition={{ duration: 1.2, delay: 0.2 }}
          cx="50" cy="50" r="45" fill="currentColor" stroke="none" 
        />
      </motion.svg>
    );
  }
  return null;
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
