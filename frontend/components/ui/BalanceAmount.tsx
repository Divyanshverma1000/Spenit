"use client";

import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

interface BalanceAmountProps {
  amount: number | string;
  direction: 'positive' | 'negative' | 'settled' | 'owed' | 'owes';
  variant?: 'hero' | 'default' | 'compact';
  showSign?: boolean;
  showCurrency?: boolean;
  showDirection?: boolean;
  className?: string;
}

export function BalanceAmount({
  amount,
  direction,
  variant = 'default',
  showSign = true,
  showCurrency = true,
  showDirection = false,
  className,
}: BalanceAmountProps) {
  // Normalize direction aliases from API
  const normalizedDirection = direction === 'owed' ? 'positive' : direction === 'owes' ? 'negative' : direction;
  const numAmount = typeof amount === 'string' ? parseFloat(amount) || 0 : amount;

  const isPositive = normalizedDirection === 'positive';
  const isNegative = normalizedDirection === 'negative';
  const isSettled = normalizedDirection === 'settled';

  let colorClass = "text-[var(--text-muted)]";
  if (variant === 'hero') {
    colorClass = "text-[var(--text-primary)]";
  } else {
    if (isPositive) colorClass = "text-[var(--positive)]";
    if (isNegative) colorClass = "text-[var(--negative)]";
  }

  let prefix = "";
  if (showSign) {
    if (isPositive) prefix = "+";
    if (isNegative) prefix = "−"; // U+2212
  }

  const baseClass = "tabular-nums lining-nums flex items-baseline";
  
  let variantClass = "";
  if (variant === 'hero') {
    variantClass = "font-[family-name:var(--font-display)] text-[48px] balance-reveal";
  } else if (variant === 'default') {
    variantClass = "font-[family-name:var(--font-body)] text-base font-semibold";
  } else if (variant === 'compact') {
    variantClass = "font-[family-name:var(--font-body)] text-sm font-semibold";
  }

  const ariaLabel = `${normalizedDirection} balance of ${numAmount} rupees`;

  return (
    <div
      className={cn(baseClass, colorClass, variantClass, className)}
      aria-label={ariaLabel}
    >
      {prefix}
      {showCurrency && (
        <span
          className={cn(
            variant === 'hero' ? "font-[family-name:var(--font-body)] text-[28px] font-medium mr-1" : "mr-0.5",
            isSettled && "text-[var(--text-muted)]"
          )}
        >
          ₹
        </span>
      )}
      <span>{numAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      {showDirection && isPositive && (
        <TrendingUp className="ml-1 w-4 h-4" strokeWidth={1.5} />
      )}
      {showDirection && isNegative && (
        <TrendingDown className="ml-1 w-4 h-4" strokeWidth={1.5} />
      )}
    </div>
  );
}
