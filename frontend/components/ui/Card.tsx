import React from 'react';

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

interface CardProps {
  children: React.ReactNode;
  accentEdge?: 'positive' | 'negative' | 'accent' | 'none';
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
  onClick?: () => void;
}

export function Card({
  children,
  accentEdge = 'none',
  className,
  padding = 'md',
  style,
  onClick,
}: CardProps) {
  let accentClass = '';
  if (accentEdge === 'positive') accentClass = 'card-accent-positive';
  else if (accentEdge === 'negative') accentClass = 'card-accent-negative';
  else if (accentEdge === 'accent') accentClass = 'card-accent-accent';

  let paddingClass = 'p-4'; // default md
  if (padding === 'none') paddingClass = '';
  if (padding === 'sm') paddingClass = 'p-3';
  if (padding === 'lg') paddingClass = 'p-6';

  return (
    <div className={cn('card', accentClass, paddingClass, className)} style={style} onClick={onClick}>
      {children}
    </div>
  );
}
