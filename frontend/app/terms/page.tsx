"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import BottomNav from "@/components/BottomNav";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-main)] pb-24 text-[var(--text-primary)]">
      <header className="px-5 py-4 flex items-center gap-4 bg-[var(--bg-main)]/80 backdrop-blur-md sticky top-0 z-10 border-b border-[rgba(0,0,0,0.05)]">
        <Link href="/profile" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 -ml-1 active:scale-95 transition-transform">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-[17px] font-bold tracking-tight">Terms of Service</h1>
      </header>
      
      <main className="p-6 max-w-lg mx-auto">
        <div className="prose prose-invert prose-sm">
          <h2 className="text-[20px] font-extrabold mb-4">Terms and Conditions</h2>
          <p className="text-[14px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            By using Spenit, you agree to these terms. Please read them carefully.
          </p>
          
          <h3 className="text-[16px] font-bold mb-2 mt-6">1. Usage</h3>
          <p className="text-[14px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            Spenit is a personal and group expense management tool. You agree to use it only for its intended purposes and not for any unlawful activity.
          </p>
          
          <h3 className="text-[16px] font-bold mb-2 mt-6">2. User Content</h3>
          <p className="text-[14px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            You are responsible for the expenses and data you log. We provide a platform for calculation and tracking.
          </p>

          <h3 className="text-[16px] font-bold mb-2 mt-6">3. Bring Your Own AI</h3>
          <p className="text-[14px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            Users are responsible for the usage costs and limits associated with the API keys they provide (e.g., Groq API keys) for AI functionalities.
          </p>
          
          <p className="text-[12px] text-[var(--text-muted)] mt-8">
            Last updated: {new Date().toLocaleDateString()}
          </p>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
