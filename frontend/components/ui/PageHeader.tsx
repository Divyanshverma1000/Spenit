"use client";

import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}

export function PageHeader({ title, subtitle, onBack, rightAction }: PageHeaderProps) {
  return (
    <header className="bg-[var(--ink)] text-white px-5 pt-14 pb-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {onBack && (
          <button 
            onClick={onBack} 
            className="p-1 -ml-1 text-white hover:text-gray-300 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft size={20} strokeWidth={1.5} />
          </button>
        )}
        <div className="flex flex-col">
          <h1 className="font-[family-name:var(--font-display)] text-[22px] leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="font-[family-name:var(--font-body)] text-xs text-white/60">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {rightAction && (
        <div>
          {rightAction}
        </div>
      )}
    </header>
  );
}
