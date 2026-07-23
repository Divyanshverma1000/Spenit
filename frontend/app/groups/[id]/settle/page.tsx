"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import PushPromptBanner from "@/components/PushPromptBanner";
import DebtSimplificationGraph from "@/components/DebtSimplificationGraph";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface Transfer {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  amount: string;
}
interface SimplifiedData {
  groupName: string;
  memberBalances: { userId: string; name: string; direction: string; netAmount: string }[];
  simplifiedTransfers: Transfer[];
  fromCache: boolean;
}
interface Settlement {
  id: string;
  fromUser: { id: string; name: string };
  toUser: { id: string; name: string; avatarUrl: string | null };
  amount: string;
  method: string;
  status: "pending" | "confirmed" | "rejected";
  createdAt: string;
  isIncoming: boolean;
  isOutgoing: boolean;
}

type Screen = "overview" | "pay" | "cash" | "pending";

function buildUpiDeepLink(upiId: string, name: string, amount: string): string {
  const params = new URLSearchParams({ pa: upiId, pn: name, am: parseFloat(amount).toFixed(2), cu: "INR", tn: "Spenit settlement" });
  return `upi://pay?${params.toString()}`;
}

export default function SettleUpPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const { accessToken, user } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<SimplifiedData | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("overview");
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken || !groupId) return;
    const [bRes, sRes] = await Promise.all([
      fetch(`${API_URL}/balance/groups/${groupId}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`${API_URL}/settlements?groupId=${groupId}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);
    if (bRes.ok) setData(await bRes.json());
    if (sRes.ok) setSettlements(await sRes.json());
    setLoading(false);
  }, [accessToken, groupId]);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // 30-second polling so data stays live without requiring a hard refresh
  useEffect(() => {
    const interval = setInterval(() => { load(); }, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  // Visibility-based refresh: reload when tab becomes active again
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  async function initiateSettlement(transfer: Transfer, method: "upi" | "cash") {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/settlements`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, toUserId: transfer.to, amount: transfer.amount, method }),
      });
      const data = await res.json();
      if (res.ok) {
        if (method === "upi" && data.upiDeepLink) {
          // Open UPI app
          window.location.href = data.upiDeepLink;
        }
        await load();
        setScreen("pending");
      }
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  }

  async function confirmSettlement(settlementId: string) {
    setConfirming(settlementId);
    try {
      await fetch(`${API_URL}/settlements/${settlementId}/confirm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      await load(); // balance cache is invalidated server-side; reload shows updated balance
    } catch (e) { console.error(e); }
    finally { setConfirming(null); }
  }

  async function rejectSettlement(settlementId: string) {
    setConfirming(settlementId);
    try {
      await fetch(`${API_URL}/settlements/${settlementId}/reject`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      await load();
    } catch (e) { console.error(e); }
    finally { setConfirming(null); }
  }

  if (!authed) return null;

  const pendingSettlements = settlements.filter((s) => s.status === "pending");
  const confirmedSettlements = settlements.filter((s) => s.status === "confirmed");
  const myOutgoing = data?.simplifiedTransfers.filter((t) => t.from === user?.id) ?? [];
  const othersTransfers = data?.simplifiedTransfers.filter((t) => t.from !== user?.id) ?? [];
  const allTransfers = data?.simplifiedTransfers ?? [];
  const naiveCount = data?.memberBalances.filter((m) => m.direction !== "settled").length ?? 0;

  return (
    <>
      <main className="min-h-screen bg-[#0a0a12] page-content">
        {/* Push prompt — settle page is perfect context: user is actively managing money */}
        {typeof window !== "undefined" &&
          !localStorage.getItem("push-prompt-dismissed") &&
          Notification.permission === "default" && (
          <div className="pt-14">
            <PushPromptBanner
              onDismiss={() => {
                localStorage.setItem("push-prompt-dismissed", "1");
              }}
            />
          </div>
        )}
        {/* Header */}
        <div className="px-5 pt-14 pb-3 flex items-center gap-3">
          <button onClick={() => router.back()} className="text-slate-500 hover:text-slate-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Settle Up</h1>
            {data && <p className="text-slate-500 text-xs">{data.groupName}</p>}
          </div>
          {/* Manual refresh button */}
          <button
            onClick={load}
            className="text-slate-500 hover:text-slate-300 transition-colors p-1.5"
            title="Refresh"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Tab pills */}
        <div className="px-5 flex gap-2 mb-5">
          {(["overview", "pending"] as Screen[]).map((s) => (
            <button key={s} onClick={() => setScreen(s)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                screen === s ? "bg-violet-600 text-white" : "border border-white/10 text-slate-400"
              }`}>
              {s === "overview" ? "Transfers" : `Pending${pendingSettlements.length > 0 ? ` (${pendingSettlements.length})` : ""}`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          </div>
        ) : screen === "overview" ? (
          <div className="px-5 space-y-4">
            {/* Debt Simplification Graph */}
            {data && data.memberBalances.length > 0 && (
              <DebtSimplificationGraph
                transfers={allTransfers}
                memberBalances={data.memberBalances as Parameters<typeof DebtSimplificationGraph>[0]["memberBalances"]}
                currentUserId={user?.id || ""}
                memberCount={data.memberBalances.length}
              />
            )}

            {/* Plain-language explanation */}
            {allTransfers.length > 0 && naiveCount > allTransfers.length && (
              <div className="glass-card p-4 border-violet-500/20 bg-violet-500/5">
                <p className="text-sm text-violet-300 font-medium">
                  ✨ Instead of {naiveCount}+ individual payments, only{" "}
                  <span className="text-violet-200 font-bold">{allTransfers.length}</span>{" "}
                  {allTransfers.length === 1 ? "payment is" : "payments are"} needed.
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Debt simplification algorithm reduces the number of transfers.
                </p>
              </div>
            )}

            {allTransfers.length === 0 ? (
              <div className="glass-card p-10 text-center">
                <p className="text-4xl mb-3">🎉</p>
                <p className="text-white font-bold text-lg mb-1">All settled up!</p>
                <p className="text-slate-500 text-sm">No outstanding debts in this group.</p>
              </div>
            ) : (
              <>
                {/* My payments */}
                {myOutgoing.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">You need to pay</p>
                    <div className="space-y-2">
                      {myOutgoing.map((t, i) => (
                        <div key={i} className="glass-card p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <p className="font-semibold text-white">
                                You → <span className="text-emerald-400">{t.toName}</span>
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">To settle your share</p>
                            </div>
                            <p className="text-xl font-bold text-white">₹{parseFloat(t.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setSelectedTransfer(t); initiateSettlement(t, "upi"); }}
                              disabled={submitting}
                              className="flex-1 btn-primary py-2.5 text-sm text-center disabled:opacity-50"
                            >
                              {submitting && selectedTransfer === t ? "Opening UPI…" : "💳 Pay via UPI"}
                            </button>
                            <button
                              onClick={() => { setSelectedTransfer(t); initiateSettlement(t, "cash"); }}
                              disabled={submitting}
                              className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm text-slate-300 disabled:opacity-50"
                            >
                              💵 Log Cash
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Others' payments */}
                {othersTransfers.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Others need to pay</p>
                    <div className="space-y-2">
                      {othersTransfers.map((t, i) => (
                        <div key={i} className="glass-card p-4 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-white">
                              <span className="text-rose-400">{t.fromName}</span> → {t.to === user?.id ? <span className="text-emerald-400">You</span> : t.toName}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {t.to === user?.id ? "They owe you — you'll confirm when received" : "This doesn't involve you"}
                            </p>
                          </div>
                          <p className="text-sm font-bold text-white">₹{parseFloat(t.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Recent confirmed */}
            {confirmedSettlements.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Settled</p>
                <div className="space-y-2">
                  {confirmedSettlements.slice(0, 3).map((s) => (
                    <div key={s.id} className="flex items-center gap-3 px-4 py-3 glass-card">
                      <span className="text-emerald-400 text-lg">✓</span>
                      <p className="text-sm text-slate-400 flex-1">
                        {s.fromUser.name} paid {s.toUser.name}{" "}
                        <span className="text-white font-semibold">₹{parseFloat(s.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Pending settlements tab ─────────────────────────────────────── */
          <div className="px-5 space-y-3">
            {pendingSettlements.length === 0 ? (
              <div className="glass-card p-10 text-center">
                <p className="text-3xl mb-3">✓</p>
                <p className="text-white font-semibold">No pending settlements</p>
                <p className="text-slate-500 text-sm mt-1">All payments have been confirmed or rejected.</p>
              </div>
            ) : pendingSettlements.map((s) => (
              <div key={s.id} className={`glass-card p-5 ${s.isIncoming ? "border-amber-500/20 bg-amber-500/5" : ""}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {s.isOutgoing ? (
                        <>You → <span className="text-emerald-400">{s.toUser.name}</span></>
                      ) : s.isIncoming ? (
                        <><span className="text-violet-400">{s.fromUser.name}</span> → You</>
                      ) : (
                        <>{s.fromUser.name} → {s.toUser.name}</>
                      )}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {s.method === "upi" ? "UPI transfer" : s.method === "cash" ? "Cash payment" : "Manual log"}
                      {" · "}{new Date(s.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <p className="text-lg font-bold text-white">
                    ₹{parseFloat(s.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </p>
                </div>

                <div className="rounded-xl bg-amber-500/10 border border-amber-500/15 px-3 py-2 text-xs text-amber-400 mb-3">
                  ⏳ Awaiting confirmation from {s.isOutgoing ? s.toUser.name : "the recipient"}
                  {s.isIncoming && " (that's you!)"}
                </div>

                {/* The recipient (toUser) must confirm — two-way confirmation enforced */}
                {s.isIncoming && (
                  <div className="flex gap-2">
                    <button onClick={() => confirmSettlement(s.id)} disabled={confirming === s.id}
                      className="flex-1 btn-primary py-2.5 text-sm disabled:opacity-50">
                      {confirming === s.id ? "Confirming…" : "✓ I received this payment"}
                    </button>
                    <button onClick={() => rejectSettlement(s.id)} disabled={confirming === s.id}
                      className="flex-shrink-0 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-2.5 text-sm text-rose-400 disabled:opacity-50">
                      Reject
                    </button>
                  </div>
                )}
                {s.isOutgoing && (
                  <p className="text-xs text-slate-600">
                    Balance will clear once {s.toUser.name} confirms they received it.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}
