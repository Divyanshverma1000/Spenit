import React from 'react';

interface SectionLabelProps {
  children: React.ReactNode;
  className?: string;
}

export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <p className={`section-label uppercase ${className || ''}`}>
      {children}
    </p>
  );
}
