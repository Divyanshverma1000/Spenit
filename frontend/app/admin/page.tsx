"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { readJson } from "@/lib/api";
import { AdminDashboard, ago, type Stats } from "@/components/admin/AdminDashboard";

/**
 * Owner's dashboard: how many people use Spenit (now, today, this week, this month),
 * what they use, what the AI costs, and which errors are happening. Counts only.
 */
export default function AdminPage() {
  const authed = useRequireAuth();
  const router = useRouter();
  const { authFetch } = useAuth();
  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => readJson<Stats>(await authFetch("/admin/stats")),
    enabled: authed,
    refetchInterval: 60_000,
    retry: false,
  });

  if (!authed) return null;
  const s = stats.data;
  const forbidden = (stats.error as { status?: number } | null)?.status === 403;

  return (
    <main className="min-h-screen bg-[var(--ink)] text-[var(--text-primary)] pb-16">
      <header className="sticky top-0 z-10 bg-[var(--ink)]/90 backdrop-blur-md px-4 pt-12 pb-3 flex items-center gap-2 border-b border-[var(--hairline)]">
        <button onClick={() => router.push("/profile")} className="p-1.5 -ml-1 text-[var(--text-secondary)]" aria-label="Back"><ChevronLeft size={22} /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[20px] font-extrabold leading-tight">Admin</h1>
          <p className="text-[12px] text-[var(--text-secondary)]">{s ? `Updated ${ago(s.generatedAt)} · refreshes every minute` : "Spenit at a glance"}</p>
        </div>
        <button onClick={() => stats.refetch()} className="p-2 text-[var(--text-secondary)]" aria-label="Refresh">
          {stats.isFetching ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
        </button>
      </header>

      <div className="px-4 py-5 max-w-3xl mx-auto space-y-6">
        {stats.isPending ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[var(--text-muted)]" /></div>
        ) : forbidden ? (
          <div className="p-6 rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] text-center">
            <ShieldAlert className="mx-auto text-[var(--text-muted)]" />
            <p className="mt-2 font-bold">Admins only</p>
            <p className="text-[13px] text-[var(--text-secondary)] mt-1">This account isn&apos;t on the admin list.</p>
          </div>
        ) : !s ? (
          <p className="text-[14px] text-[var(--text-secondary)]">Couldn&apos;t load the numbers. Try refreshing.</p>
        ) : (
          <AdminDashboard
            s={s}
            onFeedbackDone={async (id, done) => {
              await authFetch(`/feedback/${id}`, { method: "PATCH", body: JSON.stringify({ status: done ? "done" : "new" }) }).catch(() => {});
              stats.refetch();
            }}
          />
        )}
      </div>
    </main>
  );
}
