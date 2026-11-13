"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";
import { detectPlatform } from "@/lib/testPlan";
import { TestingView } from "@/components/testing/TestingView";
import FeedbackSheet from "@/components/FeedbackSheet";
import { ask, toast } from "@/lib/dialog";

const noSubscribe = () => () => {};

/**
 * spenit.vercel.app/testing: the checklist friends and family run before launch.
 * Problems and the final summary go to /admin like any other report.
 */
export default function TestingPage() {
  const { isAuthenticated, authFetch } = useAuth();
  const router = useRouter();
  const platform = useSyncExternalStore(noSubscribe, () => detectPlatform(navigator.userAgent), () => null);
  const [problemFor, setProblemFor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function send(summary: string) {
    setSending(true);
    try {
      await readJson(await authFetch("/feedback", {
        method: "POST",
        body: JSON.stringify({ kind: "test", message: summary, page: "/testing", appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev" }),
      }));
      setSent(true);
    } catch {
      toast("Couldn't send. Check your connection and try again.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--ink)] text-[var(--text-primary)] pb-16">
      <header className="sticky top-0 z-10 bg-[var(--ink)]/90 backdrop-blur-md px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2 flex items-center gap-2 border-b border-[var(--hairline)]">
        <Link href={isAuthenticated ? "/dashboard" : "/auth"} className="p-2 -ml-1 text-[var(--text-secondary)]" aria-label="Back"><ChevronLeft size={22} /></Link>
        <span className="font-bold text-[16px]">Testing checklist</span>
      </header>
      <div className="px-5 py-5 max-w-md mx-auto">
        <TestingView
          platform={platform}
          signedIn={isAuthenticated}
          sending={sending}
          sent={sent}
          onSend={send}
          onProblem={(title) => {
            if (isAuthenticated) { setProblemFor(title); return; }
            void ask({
              title: "Sign in to report it",
              body: "Then we know who found the problem and can follow up with you.",
              confirmLabel: "Sign in",
              cancelLabel: "Not now",
            }).then((go) => { if (go) router.push("/auth"); });
          }}
        />
      </div>
      {problemFor && (
        <FeedbackSheet
          from={`/testing#${problemFor}`}
          label={`Problem with: ${problemFor}`}
          initialMessage={`[Test: ${problemFor}] `}
          onClose={() => setProblemFor(null)}
        />
      )}
    </main>
  );
}
