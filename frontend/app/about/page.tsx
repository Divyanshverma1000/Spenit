"use client";

import { ChevronLeft, Github, Globe } from "lucide-react";
import Link from "next/link";
import BottomNav from "@/components/BottomNav";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-main)] pb-24 text-[var(--text-primary)]">
      <header className="px-5 py-4 flex items-center gap-4 bg-[var(--bg-main)]/80 backdrop-blur-md sticky top-0 z-10 border-b border-[rgba(0,0,0,0.05)]">
        <Link href="/profile" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 -ml-1 active:scale-95 transition-transform">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-[17px] font-bold tracking-tight">About Spenit</h1>
      </header>
      
      <main className="p-6 max-w-lg mx-auto flex flex-col items-center text-center mt-8">
        <div className="w-24 h-24 rounded-3xl bg-[var(--accent)] flex items-center justify-center text-white font-extrabold text-[40px] shadow-[0_8px_30px_rgba(245,158,11,0.3)] mb-6">
          S
        </div>
        <h2 className="text-[24px] font-extrabold mb-2">Spenit</h2>
        <p className="text-[14px] text-[var(--text-secondary)] mb-8">
          Version 1.0.0
        </p>

        <p className="text-[15px] text-[var(--text-primary)] mb-8 max-w-sm leading-relaxed">
          Spenit is an intelligent, premium expense tracking application. It simplifies group settlements, parses receipts using AI, and gives you a personal financial manager.
        </p>
        
        <div className="flex gap-4">
          <a href="#" className="w-12 h-12 rounded-full bg-[var(--paper)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors border border-[rgba(0,0,0,0.05)]">
            <Globe size={20} />
          </a>
          <a href="https://github.com/Divyanshverma1000/Spenit" target="_blank" rel="noreferrer" className="w-12 h-12 rounded-full bg-[var(--paper)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors border border-[rgba(0,0,0,0.05)]">
            <Github size={20} />
          </a>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
