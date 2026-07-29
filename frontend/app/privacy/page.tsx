"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import BottomNav from "@/components/BottomNav";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-main)] pb-24 text-[var(--text-primary)]">
      <header className="px-5 py-4 flex items-center gap-4 bg-[var(--bg-main)]/80 backdrop-blur-md sticky top-0 z-10 border-b border-[rgba(0,0,0,0.05)]">
        <Link href="/profile" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 -ml-1 active:scale-95 transition-transform">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-[17px] font-bold tracking-tight">Privacy Policy</h1>
      </header>
      
      <main className="p-6 max-w-lg mx-auto">
        <div className="prose prose-invert prose-sm">
          <h2 className="text-[20px] font-extrabold mb-4">Your Privacy Matters</h2>
          <p className="text-[14px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            At Spenit, we take your privacy seriously. This policy describes what personal information we collect and how we use it.
          </p>
          
          <h3 className="text-[16px] font-bold mb-2 mt-6">1. Data Collection</h3>
          <p className="text-[14px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            We collect information you provide directly to us, such as when you create or modify your account, or log expenses.
          </p>
          
          <h3 className="text-[16px] font-bold mb-2 mt-6">2. Use of Data</h3>
          <p className="text-[14px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            We use the information we collect to provide, maintain, and improve our services, such as calculating group balances.
          </p>

          <h3 className="text-[16px] font-bold mb-2 mt-6">3. Third Party Services (AI)</h3>
          <p className="text-[14px] text-[var(--text-secondary)] mb-4 leading-relaxed">
            Spenit allows you to bring your own API keys for AI services (e.g., Groq). Receipt images and text are sent directly to the configured AI provider. We do not store these images permanently.
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
