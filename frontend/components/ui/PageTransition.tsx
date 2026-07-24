"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // If we are in the layout, we need AnimatePresence to handle exit animations
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -12, scale: 0.99 }}
        transition={{ 
          type: "spring", 
          stiffness: 260, 
          damping: 25,
          mass: 0.5 
        }}
        className="h-full w-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
