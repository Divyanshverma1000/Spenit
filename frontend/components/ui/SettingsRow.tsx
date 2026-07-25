import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface SettingsRowProps {
  icon?: React.ReactNode;
  label: string;
  value?: string | React.ReactNode;
  href?: string;
  onClick?: () => void;
  destructive?: boolean;
}

export function SettingsRow({ icon, label, value, href, onClick, destructive }: SettingsRowProps) {
  const content = (
    <div className="flex items-center gap-3 w-full">
      {icon && (
        <div className={`flex-shrink-0 ${destructive ? "text-[var(--negative)]" : "text-[var(--accent)]"}`}>
          {icon}
        </div>
      )}
      <div className={`flex-1 text-[16px] font-medium text-left ${destructive ? "text-[var(--negative)]" : "text-[var(--text-primary)]"}`}>
        {label}
      </div>
      {value && (
        <div className="text-[15px] text-[var(--text-secondary)] font-medium">
          {value}
        </div>
      )}
      {(href || onClick) && !destructive && (
        <ChevronRight size={18} className="text-[var(--text-muted)] ml-1" />
      )}
    </div>
  );

  const className = "flex items-center w-full px-5 py-4 bg-white hover:bg-[var(--paper-dim)] transition-colors active:bg-[var(--border-dark)] outline-none";

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return (
    <div className={`flex items-center w-full px-5 py-4 bg-white`}>
      {content}
    </div>
  );
}
