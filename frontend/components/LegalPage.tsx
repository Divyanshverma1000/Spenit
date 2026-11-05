"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { LEGAL } from "@/lib/legal";

/** Shared layout for the Privacy Policy and Terms: readable width, numbered sections. */
export function LegalPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-[var(--ink)] text-[var(--text-primary)] pb-16">
      <header className="px-4 py-3 flex items-center gap-2 bg-[var(--ink)]/90 backdrop-blur-md sticky top-0 z-10 border-b border-[var(--hairline)]">
        <button onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))} className="p-2 -ml-1 text-[var(--text-secondary)]" aria-label="Back">
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-[17px] font-bold tracking-tight">{title}</h1>
      </header>
      <main className="px-5 py-6 max-w-2xl mx-auto">
        <p className="text-[12px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          Effective {LEGAL.EFFECTIVE} · Version {LEGAL.VERSION}
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-secondary)]">{intro}</p>
        <div className="mt-6 space-y-7 text-[14.5px] leading-relaxed text-[var(--text-secondary)] [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:text-[var(--text-primary)] [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_b]:text-[var(--text-primary)] [&_a]:text-[var(--accent)] [&_a]:font-semibold">
          {children}
        </div>
      </main>
    </div>
  );
}

export const Mail = () => <a href={`mailto:${LEGAL.CONTACT_EMAIL}`}>{LEGAL.CONTACT_EMAIL}</a>;
