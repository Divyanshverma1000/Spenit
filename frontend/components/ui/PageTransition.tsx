"use client";

import React from "react";

/**
 * Route content wrapper.
 *
 * Deliberately NOT an exit/enter framer-motion transition: `AnimatePresence
 * mode="wait"` made every navigation play an exit animation before the next
 * page could even start rendering. A CSS fade-in on mount (see .page-enter)
 * feels just as smooth and never blocks the next screen.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return <div className="h-full w-full page-enter">{children}</div>;
}
