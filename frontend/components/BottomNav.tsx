"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Users, User } from 'lucide-react';
import { motion } from 'framer-motion';

export default function BottomNav() {
  const pathname = usePathname();

  const navItems = [
    { label: 'Home', href: '/dashboard', icon: Home },
    { label: 'Groups', href: '/groups', icon: Users },
    { label: 'Profile', href: '/profile', icon: User },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--paper)] border-t border-[var(--border-dark)] shadow-[0_-4px_20px_rgba(0,0,0,0.03)] safe-area-pb">
      <nav className="max-w-md mx-auto flex justify-around items-center h-16">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex flex-col items-center justify-center w-full h-full min-w-[44px] min-h-[44px]"
            >
              {isActive && (
                <motion.div 
                  layoutId="bottom-nav-indicator"
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[var(--accent)]"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <Icon 
                size={20} 
                strokeWidth={1.5} 
                className={isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} 
              />
              <span 
                className={`mt-1 font-[family-name:var(--font-body)] text-[11px] ${
                  isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
