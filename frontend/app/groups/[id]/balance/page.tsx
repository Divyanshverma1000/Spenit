"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface MemberBalance {
  userId: string; name: string; username: string; avatarUrl: string | null;
  netAmount: string; direction: "owed" | "owes" | "settled"; signedAmount: string;
}
interface Transfer {
  from: string; to: string; amount: string; fromName: string; toName: string;
}
interface GroupBalance {
  groupId: string; groupName: string;
  myBalance: { netAmount: string; direction: "owed" | "owes" | "settled"; signedAmount: string };
  memberBalances: MemberBalance[];
  simplifiedTransfers: Transfer[];
  fromCache: boolean;
}

export default function GroupBalancePage() {
  const { id: groupId } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const { accessToken, user } = useAuth();
  const router = useRouter();
  const [balance, setBalance] = useState<GroupBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTxns, setShowTxns] = useState(false);

  useEffect(() => {
    if (!accessToken || !groupId) return;
    fetch(`${API_URL}/balance/groups/${groupId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => { if (!r.ok) throw new Error("Not found"); return r.json(); })
      .then(setBalance)
      .catch(() => router.replace("/groups"))
      .finally(() => setLoading(false));
  }, [accessToken, groupId, router]);

  if (!authed) return null;

  if (loading) return (
    <>
      <main className="min-h-screen bg-[#0a0a12] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
      </main>
      <BottomNav />
    </>
  );
  if (!balance) return null;

  const { myBalance, memberBalances, simplifiedTransfers } = balance;
  const d = myBalance.direction;

  return (
    <>
      <main className="min-h-screen bg-[#0a0a12] page-content">
        <div className="px-5 pt-14 pb-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="text-slate-500">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">Balances</h1>
            <p className="text-slate-500 text-xs">{balance.groupName}</p>
          </div>
        </div>

        <div className="px-5 space-y-4">
          {/* My balance hero */}
          <div className={`relative overflow-hidden rounded-3xl p-6 ${
            d === "owed" ? "bg-gradient-to-br from-emerald-950/80 to-emerald-900/30 border border-emerald-500/20"
            : d === "owes" ? "bg-gradient-to-br from-rose-950/80 to-rose-900/30 border border-rose-500/20"
            : "bg-gradient-to-br from-slate-900 to-slate-800/50 border border-white/10"
          }`}>
            <div className={`absolute -top-8 -right-8 h-32 w-32 rounded-full blur-2xl opacity-25 ${
              d === "owed" ? "bg-emerald-400" : d === "owes" ? "bg-rose-400" : "bg-slate-400"
            }`} />
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Your balance in this group</p>
            <div className="flex items-end gap-1">
              <span className="text-slate-400 text-xl">₹</span>
              <span className={`text-5xl font-bold tracking-tight ${
                d === "owed" ? "text-emerald-400" : d === "owes" ? "text-rose-400" : "text-slate-400"
              }`}>
                {parseFloat(myBalance.netAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <p className={`text-sm mt-2 ${d === "owed" ? "text-emerald-400/80" : d === "owes" ? "text-rose-400/80" : "text-slate-500"}`}>
              {d === "owed" ? "Others owe you this in total" : d === "owes" ? "You owe this in total" : "You're all settled up 🎉"}
            </p>
          </div>

          {/* Per-person breakdown */}
          {memberBalances.filter(m => m.userId !== user?.id).length > 0 && (
            <div className="glass-card p-5">
              <h2 className="text-sm font-semibold text-white mb-4">Group members</h2>
              <div className="space-y-3">
                {memberBalances.filter(m => m.userId !== user?.id).map((m) => (
                  <div key={m.userId} className="flex items-center gap-3">
                    {m.avatarUrl ? (
                      <Image src={m.avatarUrl} alt={m.name} width={36} height={36} className="rounded-full flex-shrink-0" />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500/50 to-fuchsia-500/50 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{m.name}</p>
                      <p className="text-xs text-slate-500">@{m.username}</p>
                    </div>
                    <div className="text-right">
                      {m.direction === "settled" ? (
                        <span className="text-xs text-slate-600">✓ settled</span>
                      ) : (
                        <>
                          <p className={`text-sm font-bold ${m.direction === "owed" ? "text-emerald-400" : "text-rose-400"}`}>
                            {m.direction === "owes" ? "−" : "+"}₹{parseFloat(m.netAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </p>
                          <p className="text-xs text-slate-600">{m.direction === "owed" ? "is owed" : "owes group"}</p>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Simplified transfers */}
          {simplifiedTransfers.length > 0 ? (
            <div className="glass-card p-5 border-violet-500/15 bg-violet-500/5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-violet-300">Simplified transfers</h2>
                <span className="text-xs text-slate-500">{simplifiedTransfers.length} payment{simplifiedTransfers.length !== 1 ? "s" : ""} needed</span>
              </div>
              <div className="space-y-2">
                {simplifiedTransfers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={`font-medium ${t.from === user?.id ? "text-rose-400" : "text-slate-300"}`}>
                      {t.from === user?.id ? "You" : t.fromName}
                    </span>
                    <svg className="h-3 w-3 text-slate-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <span className={`font-medium ${t.to === user?.id ? "text-emerald-400" : "text-slate-300"}`}>
                      {t.to === user?.id ? "You" : t.toName}
                    </span>
                    <span className="ml-auto font-bold text-white">₹{parseFloat(t.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
              <Link href={`/groups/${groupId}/settle`}
                className="mt-4 w-full btn-primary py-3 text-sm text-center block">
                💸 Settle Up Now
              </Link>
            </div>
          ) : (
            <div className="glass-card p-8 text-center border-emerald-500/15 bg-emerald-500/5">
              <p className="text-3xl mb-2">🎉</p>
              <p className="text-emerald-400 font-bold">All settled up!</p>
              <p className="text-slate-500 text-sm mt-1">No outstanding balances in this group.</p>
            </div>
          )}

          {/* Optional drill-down (never default — ProductDetailIDEA §2) */}
          <div className="glass-card overflow-hidden">
            <button onClick={() => setShowTxns(!showTxns)}
              className="w-full flex items-center justify-between p-4 text-sm text-slate-400 hover:text-slate-300 transition-colors">
              <span>View transaction history</span>
              <svg className={`h-4 w-4 transition-transform ${showTxns ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showTxns && (
              <div className="border-t border-white/5 p-4">
                <Link href={`/groups/${groupId}`} className="text-sm text-violet-400 hover:text-violet-300">
                  → View all expenses in this group
                </Link>
              </div>
            )}
          </div>

          {balance.fromCache && <p className="text-center text-xs text-slate-700">⚡ Served from cache</p>}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
