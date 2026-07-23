"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface GroupBreakdown {
  groupId: string;
  groupName: string;
  netAmount: string;
  direction: "owed" | "owes" | "settled";
  signedAmount: string;
}
interface CrossGroupBalance {
  netAmount: string;
  direction: "owed" | "owes" | "settled";
  breakdown: GroupBreakdown[];
}

function Spinner() {
  return <div className="h-6 w-6 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />;
}

export default function DashboardPage() {
  const authed = useRequireAuth();
  const { user, accessToken } = useAuth();
  const [balance, setBalance] = useState<CrossGroupBalance | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBalance = useCallback(() => {
    if (!accessToken) return;
    fetch(`${API_URL}/balance/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json())
      .then(setBalance)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  // Initial load
  useEffect(() => { loadBalance(); }, [loadBalance]);

  // 30s polling — dashboard balance stays live
  useEffect(() => {
    const interval = setInterval(loadBalance, 30_000);
    return () => clearInterval(interval);
  }, [loadBalance]);

  // Refresh on tab focus
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadBalance(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadBalance]);

  if (!authed) return null;

  const direction = balance?.direction ?? "settled";
  const netNum = parseFloat(balance?.netAmount ?? "0");

  return (
    <>
      <main className="min-h-screen bg-[#0a0a12] page-content">
        {/* Header */}
        <div className="px-5 pt-14 pb-4">
          <p className="text-slate-500 text-xs font-medium uppercase tracking-widest">Overview</p>
          <h1 className="text-2xl font-bold text-white mt-0.5">
            Hi, {user?.name?.split(" ")[0] || "there"} 👋
          </h1>
        </div>

        {/* ── Hero balance card ──────────────────────────────────────────────── */}
        <div className="px-5 mb-5">
          <div className={`relative overflow-hidden rounded-3xl p-6 ${
            direction === "owed"
              ? "bg-gradient-to-br from-emerald-950/80 to-emerald-900/30 border border-emerald-500/20"
              : direction === "owes"
                ? "bg-gradient-to-br from-rose-950/80 to-rose-900/30 border border-rose-500/20"
                : "bg-gradient-to-br from-slate-900 to-slate-800/50 border border-white/10"
          }`}>
            {/* Ambient glow */}
            <div className={`absolute -top-8 -right-8 h-32 w-32 rounded-full blur-2xl opacity-30 ${
              direction === "owed" ? "bg-emerald-400" : direction === "owes" ? "bg-rose-400" : "bg-slate-400"
            }`} />

            <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-3">
              Your overall balance
            </p>

            {loading ? (
              <div className="flex items-center gap-3 py-2"><Spinner /><span className="text-slate-500 text-sm">Calculating…</span></div>
            ) : (
              <>
                <div className="flex items-end gap-1 mb-2">
                  <span className="text-slate-400 text-xl font-light">₹</span>
                  <span id="dashboard-hero-amount" className={`text-5xl font-bold tracking-tight ${
                    direction === "owed" ? "text-emerald-400" : direction === "owes" ? "text-rose-400" : "text-slate-400"
                  }`}>
                    {netNum.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <p className={`text-sm font-medium ${
                  direction === "owed" ? "text-emerald-400/80" : direction === "owes" ? "text-rose-400/80" : "text-slate-500"
                }`}>
                  {direction === "owed"
                    ? "You are owed across all groups"
                    : direction === "owes"
                      ? "You owe across all groups"
                      : "All settled up everywhere 🎉"}
                </p>
              </>
            )}
          </div>
        </div>

        {/* ── Quick actions ─────────────────────────────────────────────────── */}
        <div className="px-5 mb-6">
          <div className="grid grid-cols-2 gap-3">
            <Link href="/groups/new" className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 hover:bg-white/8 transition-colors active:scale-95">
              <span className="h-10 w-10 rounded-xl bg-violet-500/20 flex items-center justify-center text-xl flex-shrink-0">+</span>
              <div>
                <p className="text-sm font-semibold text-white">New Group</p>
                <p className="text-xs text-slate-500">Create & invite</p>
              </div>
            </Link>
            <Link href="/groups" className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 hover:bg-white/8 transition-colors active:scale-95">
              <span className="h-10 w-10 rounded-xl bg-fuchsia-500/20 flex items-center justify-center text-xl flex-shrink-0">👥</span>
              <div>
                <p className="text-sm font-semibold text-white">My Groups</p>
                <p className="text-xs text-slate-500">{balance?.breakdown.length ?? 0} active</p>
              </div>
            </Link>
          </div>
        </div>

        {/* ── Per-group breakdown ───────────────────────────────────────────── */}
        {balance && balance.breakdown.length > 0 && (
          <div className="px-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">By Group</p>
            <div className="space-y-2">
              {balance.breakdown.map((g) => (
                <Link key={g.groupId} href={`/groups/${g.groupId}`}
                  className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 p-4 hover:bg-white/8 transition-colors active:scale-[0.98]">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/10 flex items-center justify-center text-lg flex-shrink-0">
                    👥
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{g.groupName}</p>
                    <p className="text-xs text-slate-500">
                      {g.direction === "settled" ? "Settled" : g.direction === "owed" ? "You are owed" : "You owe"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {g.direction !== "settled" && (
                      <span className={`text-sm font-bold ${g.direction === "owed" ? "text-emerald-400" : "text-rose-400"}`}>
                        {g.direction === "owes" ? "−" : "+"}₹{parseFloat(g.netAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    )}
                    {g.direction === "settled" && <span className="text-xs text-slate-500">✓</span>}
                    <svg className="h-3.5 w-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {balance && balance.breakdown.length === 0 && !loading && (
          <div className="px-5">
            <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
              <p className="text-4xl mb-3">🏕️</p>
              <p className="text-white font-semibold mb-1">No groups yet</p>
              <p className="text-slate-500 text-sm mb-5">Create a group and invite your friends</p>
              <Link href="/groups/new" className="btn-primary inline-flex px-5 py-2.5 text-sm">
                + Create First Group
              </Link>
            </div>
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}
