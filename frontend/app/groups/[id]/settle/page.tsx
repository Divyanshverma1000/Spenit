"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  Sparkles,
  CreditCard,
  Banknote,
  CheckCircle2,
  Clock,
  Check,
  X
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import PushPromptBanner from "@/components/PushPromptBanner";
import DebtSimplificationGraph from "@/components/DebtSimplificationGraph";
import { EmptyState } from "@/components/ui/EmptyState";
import { BalanceAmount } from "@/components/ui/BalanceAmount";

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

type Screen = "overview" | "pending";

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

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const interval = setInterval(() => { load(); }, 30_000);
    return () => clearInterval(interval);
  }, [load]);

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
      const resData = await res.json();
      if (res.ok) {
        if (method === "upi" && resData.upiDeepLink) {
          window.location.href = resData.upiDeepLink;
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
      await load(); 
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
      <main className="min-h-screen page-content safe-area-pb">
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

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="px-5 pt-14 pb-4 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="h-6 w-6" strokeWidth={1.5} />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>Settle Up</h1>
            {data && <p className="text-sm font-medium text-[var(--text-secondary)]">{data.groupName}</p>}
          </div>
          <button
            onClick={load}
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-full hover:bg-[var(--paper-dim)]"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>

        {/* ── Tab pills ───────────────────────────────────────────────────── */}
        <div className="px-5 flex gap-2 mb-6">
          {(["overview", "pending"] as Screen[]).map((s) => (
            <button
              key={s}
              onClick={() => setScreen(s)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors border ${
                screen === s
                  ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--paper)]"
                  : "bg-transparent border-[var(--border-dark)] text-[var(--text-muted)] hover:border-[var(--text-secondary)]"
              }`}
            >
              {s === "overview" ? "Transfers" : `Pending${pendingSettlements.length > 0 ? ` (${pendingSettlements.length})` : ""}`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="spinner" />
          </div>
        ) : screen === "overview" ? (
          <div className="px-5 space-y-6 animate-in pb-8">
            {data && data.memberBalances.length > 0 && (
              <DebtSimplificationGraph
                transfers={allTransfers}
                memberBalances={data.memberBalances as Parameters<typeof DebtSimplificationGraph>[0]["memberBalances"]}
                currentUserId={user?.id || ""}
                memberCount={data.memberBalances.length}
              />
            )}

            {allTransfers.length > 0 && naiveCount > allTransfers.length && (
              <div className="card p-4 flex gap-3 border-l-[3px] border-l-[var(--accent)]">
                <Sparkles className="h-5 w-5 flex-shrink-0 text-[var(--accent)] mt-0.5" strokeWidth={1.5} />
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    Instead of {naiveCount}+ individual payments, only{" "}
                    <span className="tabular-nums">{allTransfers.length}</span>{" "}
                    {allTransfers.length === 1 ? "payment is" : "payments are"} needed.
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 font-medium">
                    Debt simplification reduces the number of transfers across the group.
                  </p>
                </div>
              </div>
            )}

            {allTransfers.length === 0 ? (
              <EmptyState type="all-settled" title="All Settled Up" description="There are no pending transfers in this group." />
            ) : (
              <>
                {myOutgoing.length > 0 && (
                  <div>
                    <h2 className="section-label mb-3">You need to pay</h2>
                    <div className="space-y-3">
                      {myOutgoing.map((t, i) => (
                        <div key={i} className="card card-accent-negative p-4">
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <p className="font-semibold text-[var(--text-primary)]">
                                You <span className="text-[var(--text-muted)] mx-1">→</span>{" "}
                                <span className="text-[var(--text-primary)]">{t.toName}</span>
                              </p>
                              <p className="text-xs text-[var(--text-secondary)] mt-1 font-medium">To settle your share</p>
                            </div>
                            <BalanceAmount amount={t.amount} direction="owes" variant="hero" />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setSelectedTransfer(t); initiateSettlement(t, "upi"); }}
                              disabled={submitting}
                              className="btn-primary flex-1 flex items-center justify-center gap-2 py-3 text-sm disabled:opacity-50"
                            >
                              <CreditCard className="h-4 w-4" strokeWidth={1.5} />
                              {submitting && selectedTransfer === t ? "Opening UPI…" : "Pay via UPI"}
                            </button>
                            <button
                              onClick={() => { setSelectedTransfer(t); initiateSettlement(t, "cash"); }}
                              disabled={submitting}
                              className="btn-secondary flex-1 flex items-center justify-center gap-2 py-3 text-sm disabled:opacity-50"
                            >
                              <Banknote className="h-4 w-4" strokeWidth={1.5} />
                              Log Cash
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {othersTransfers.length > 0 && (
                  <div>
                    <h2 className="section-label mb-3">Others need to pay</h2>
                    <div className="space-y-3">
                      {othersTransfers.map((t, i) => (
                        <div key={i} className="card p-4 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">
                              <span className="text-[var(--text-primary)]">{t.fromName}</span>{" "}
                              <span className="text-[var(--text-muted)] mx-1">→</span>{" "}
                              {t.to === user?.id ? (
                                <span className="text-[var(--text-primary)]">You</span>
                              ) : (
                                <span className="text-[var(--text-primary)]">{t.toName}</span>
                              )}
                            </p>
                            <p className="text-xs text-[var(--text-secondary)] mt-1 font-medium">
                              {t.to === user?.id ? "They owe you — you'll confirm when received" : "This doesn't involve you"}
                            </p>
                          </div>
                          <BalanceAmount amount={t.amount} direction={t.to === user?.id ? "owed" : "settled"} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {confirmedSettlements.length > 0 && (
              <div>
                <h2 className="section-label mb-3">Settled</h2>
                <div className="space-y-2">
                  {confirmedSettlements.slice(0, 3).map((s) => (
                    <div key={s.id} className="card p-4 flex items-center gap-3">
                      <Check className="h-5 w-5 flex-shrink-0 text-[var(--positive)]" strokeWidth={1.5} />
                      <p className="text-sm flex-1 font-medium text-[var(--text-secondary)]">
                        <span className="text-[var(--text-primary)]">{s.fromUser.name}</span> paid <span className="text-[var(--text-primary)]">{s.toUser.name}</span>{" "}
                        <span className="font-semibold text-[var(--text-primary)] ml-1 tabular-nums">
                          ₹{parseFloat(s.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="px-5 space-y-4 animate-in pb-8">
            {pendingSettlements.length === 0 ? (
              <EmptyState type="all-settled" title="No Pending Settlements" description="There are no pending settlements for this group." />
            ) : pendingSettlements.map((s) => (
              <div
                key={s.id}
                className={`card p-5 ${s.isIncoming ? "card-accent-positive" : ""}`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {s.isOutgoing ? (
                        <>You <span className="text-[var(--text-muted)] mx-1">→</span> <span className="text-[var(--text-primary)]">{s.toUser.name}</span></>
                      ) : s.isIncoming ? (
                        <><span className="text-[var(--text-primary)]">{s.fromUser.name}</span> <span className="text-[var(--text-muted)] mx-1">→</span> You</>
                      ) : (
                        <>{s.fromUser.name} <span className="text-[var(--text-muted)] mx-1">→</span> {s.toUser.name}</>
                      )}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 font-medium flex items-center gap-1.5">
                      {s.method === "upi" ? <CreditCard className="h-3 w-3" strokeWidth={1.5} /> : s.method === "cash" ? <Banknote className="h-3 w-3" strokeWidth={1.5} /> : <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />}
                      {s.method === "upi" ? "UPI transfer" : s.method === "cash" ? "Cash payment" : "Manual log"}
                      {" · "}{new Date(s.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <BalanceAmount amount={s.amount} direction={s.isOutgoing ? "owes" : s.isIncoming ? "owed" : "settled"} variant="hero" />
                </div>

                <div className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-xs font-medium bg-[var(--paper-dim)] text-[var(--text-secondary)] mb-4">
                  <Clock className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
                  Awaiting confirmation from {s.isOutgoing ? s.toUser.name : "the recipient"}
                  {s.isIncoming && " (that's you)"}
                </div>

                {s.isIncoming && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => confirmSettlement(s.id)}
                      disabled={confirming === s.id}
                      className="btn-primary flex-1 flex items-center justify-center gap-2 py-3 text-sm disabled:opacity-50 bg-[var(--positive)] hover:bg-[var(--positive)]/90"
                    >
                      <Check className="h-4 w-4" strokeWidth={1.5} />
                      {confirming === s.id ? "Confirming…" : "I received this"}
                    </button>
                    <button
                      onClick={() => rejectSettlement(s.id)}
                      disabled={confirming === s.id}
                      className="btn-secondary flex-shrink-0 flex items-center justify-center py-3 px-4 text-sm disabled:opacity-50 text-[var(--negative)] border-[var(--negative)]/30 hover:bg-[var(--negative)]/10"
                    >
                      <X className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>
                )}
                {s.isOutgoing && (
                  <p className="text-xs text-[var(--text-secondary)] font-medium text-center">
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