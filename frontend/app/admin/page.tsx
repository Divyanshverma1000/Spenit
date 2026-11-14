"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { readJson } from "@/lib/api";
import { AdminDashboard, ago, type Stats } from "@/components/admin/AdminDashboard";
import { AdminPeople, type PeopleData } from "@/components/admin/AdminPeople";
import { AdminNotifications } from "@/components/admin/AdminNotifications";

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
  const [tab, setTab] = useState<"overview" | "people">("overview");
  const people = useQuery({
    queryKey: ["admin-people"],
    queryFn: async () => readJson<PeopleData>(await authFetch("/admin/people")),
    enabled: authed && tab === "people",
    refetchInterval: 120_000,
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
        <button onClick={() => (tab === "people" ? people.refetch() : stats.refetch())} className="p-2 text-[var(--text-secondary)]" aria-label="Refresh">
          {(tab === "people" ? people.isFetching : stats.isFetching) ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
        </button>
      </header>
      {!forbidden && (
        <div className="px-4 pt-4 max-w-3xl mx-auto">
          <div className="grid grid-cols-2 p-1 rounded-[14px] bg-[var(--paper)] border border-[var(--hairline)]" role="tablist">
            {([["overview", "Overview"], ["people", `People${s ? ` · ${s.people.total}` : ""}`]] as const).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`py-2 rounded-[10px] text-[14px] font-bold ${tab === k ? "bg-[var(--accent)] text-white" : "text-[var(--text-secondary)]"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

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
        ) : tab === "people" ? (
          people.isPending ? (
            <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[var(--text-muted)]" /></div>
          ) : people.data ? (
            <AdminPeople data={people.data} />
          ) : (
            <p className="text-[14px] text-[var(--text-secondary)]">Couldn&apos;t load people. Try refreshing.</p>
          )
        ) : (
          <>
            <AdminDashboard
              s={s}
              onFeedbackDone={async (id, done) => {
                await authFetch(`/feedback/${id}`, { method: "PATCH", body: JSON.stringify({ status: done ? "done" : "new" }) }).catch(() => {});
                stats.refetch();
              }}
            />
            <AdminNotifications />
          </>
        )}
      </div>
    </main>
  );
}
