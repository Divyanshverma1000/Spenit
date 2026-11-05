"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { reportError } from "@/lib/errorReport";

/** A screen crashed: say so kindly, let them retry, and tell us about it. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <main className="min-h-screen bg-[var(--ink)] flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/illustrations/no-expenses.webp" alt="" className="w-40 h-40 mx-auto object-contain opacity-90" />
        <h1 className="mt-4 text-[20px] font-bold text-[var(--text-primary)]">Something went wrong</h1>
        <p className="mt-1.5 text-[14px] text-[var(--text-secondary)]">
          This screen hit a problem. Your data is safe. We&apos;ve been told and will look into it.
        </p>
        <div className="mt-6 flex gap-3">
          <Link href="/dashboard" className="flex-1 py-3 rounded-[14px] bg-[var(--paper)] border border-[var(--hairline)] font-bold text-[14px]">
            Go home
          </Link>
          <button onClick={() => retry()} className="flex-1 py-3 rounded-[14px] bg-[var(--accent)] text-white font-bold text-[14px] flex items-center justify-center gap-2">
            <RotateCcw size={16} /> Try again
          </button>
        </div>
      </div>
    </main>
  );
}
