"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Sparkles,
  CreditCard,
  Banknote,
  CheckCircle2,
  Clock,
  Check,
  X,
  MessageCircle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useGroupOverview } from "@/lib/queries";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import PushPromptBanner from "@/components/PushPromptBanner";
import { EmptyState } from "@/components/ui/EmptyState";
import { BalanceAmount } from "@/components/ui/BalanceAmount";
import { AnimatedAmount, PersonAvatar, SettleProgress } from "@/components/settle/parts";
import { SettleFlow, PaymentLike } from "@/components/settle/FlowGraph";
import { openWhatsApp, remindMessage, rupees } from "@/lib/share";

interface Transfer {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  amount: string;
}
interface SettleBalance {
  groupName: string;
  myBalance: { netAmount: string; direction: "owed" | "owes" | "settled" };
  memberBalances: {
    userId: string;
    name: string;
    direction: string;
    netAmount: string;
    signedAmount: string;
    isPlaceholder?: boolean;
  }[];
  simplifiedTransfers: Transfer[];
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
  canRespond?: boolean;
}

type Screen = "overview" | "pending";

export default function SettleUpPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const { user, authFetch } = useAuth();
  const router = useRouter();

  // Same cached request as the group page: opens instantly and stays in sync with it.
  const { data: overview, isPending, refetch, isFetching } = useGroupOverview(groupId);
  const data = (overview?.balance ?? null) as SettleBalance | null;
  const settlements = (overview?.settlements ?? []) as unknown as Settlement[];
  const isAdmin = overview?.group.myRole === "admin";
  const loading = isPending && !overview;
  const load = useCallback(async () => { await refetch(); }, [refetch]);

  const [screen, setScreen] = useState<Screen>("overview");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const keyOf = (t: Transfer) => `${t.from}-${t.to}`;

  // Admin records "X paid" for someone who hasn't joined; the admin then confirms as the recipient.
  async function recordOnBehalf(t: Transfer) {
    setBusyKey(keyOf(t));
    try {
      const res = await authFetch("/settlements", {
        method: "POST",
        body: JSON.stringify({ groupId, fromUserId: t.from, toUserId: t.to, amount: t.amount, method: "cash" }),
      });
      if (res.ok) { await load(); setScreen("pending"); }
    } catch (e) { console.error(e); }
    finally { setBusyKey(null); }
  }

  async function initiateSettlement(t: Transfer, method: "upi" | "cash") {
    setBusyKey(`${keyOf(t)}-${method}`);
    setNotice(null);
    try {
      const res = await authFetch("/settlements", {
        method: "POST",
        body: JSON.stringify({ groupId, toUserId: t.to, amount: t.amount, method }),
      });
      const resData = await res.json();
      if (res.ok) {
        if (method === "upi") {
          if (resData.upiDeepLink) window.location.href = resData.upiDeepLink;
          else setNotice(`${t.toName} hasn't added a UPI ID yet. Your payment is logged. Pay them directly, then they confirm it here.`);
        }
        await load();
        setScreen("pending");
      }
    } catch (e) { console.error(e); }
    finally { setBusyKey(null); }
  }

  async function respond(settlementId: string, verb: "confirm" | "reject") {
    setConfirming(settlementId);
    try {
      await authFetch(`/settlements/${settlementId}/${verb}`, { method: "POST" });
      await load();
    } catch (e) { console.error(e); }
    finally { setConfirming(null); }
  }

  if (!authed) return null;

  const pendingSettlements = settlements.filter((s) => s.status === "pending");
  const confirmedSettlements = settlements.filter((s) => s.status === "confirmed");
  const allTransfers = data?.simplifiedTransfers ?? [];
  const myOutgoing = allTransfers.filter((t) => t.from === user?.id);
  const myIncoming = allTransfers.filter((t) => t.to === user?.id);
  const others = allTransfers.filter((t) => t.from !== user?.id && t.to !== user?.id);
  const isPlaceholder = (uid: string) => !!data?.memberBalances.find((m) => m.userId === uid)?.isPlaceholder;

  const openCount = data?.memberBalances.filter((m) => m.direction !== "settled").length ?? 0;
  const naive = (openCount * (openCount - 1)) / 2;
  const saved = naive - allTransfers.length;

  const my = data?.myBalance;
  const iOwe = my?.direction === "owes";
  const iAmOwed = my?.direction === "owed";

  // Money still to move vs. already settled, for the progress meter.
  const outstanding = allTransfers.reduce((a, t) => a + parseFloat(t.amount), 0);
  const settledSoFar = confirmedSettlements.reduce((a, s) => a + parseFloat(s.amount), 0);

  const payments: PaymentLike[] = allTransfers.map((t) => ({
    from: t.from, to: t.to, fromName: t.fromName, toName: t.toName, amount: parseFloat(t.amount), original: t,
  }));
  const placeholderIds = new Set((data?.memberBalances ?? []).filter((m) => m.isPlaceholder).map((m) => m.userId));

  /** Buttons inside the diagram's detail panel. */
  const flowActions = (original: unknown) => {
    const t = original as Transfer;
    if (t.from === user?.id) {
      return (
        <button
          onClick={() => initiateSettlement(t, "upi")}
          disabled={busyKey !== null}
          className="flex-shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          Pay
        </button>
      );
    }
    if (isAdmin && isPlaceholder(t.from)) {
      return (
        <button
          onClick={() => recordOnBehalf(t)}
          disabled={busyKey !== null}
          className="flex-shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold disabled:opacity-50"
          style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
        >
          Mark paid
        </button>
      );
    }
    return null;
  };

  return (
    <>
      <main className="min-h-screen page-content safe-area-pb">
        {typeof window !== "undefined" &&
          !localStorage.getItem("push-prompt-dismissed") &&
          "Notification" in window &&
          Notification.permission === "default" && (
          <div className="pt-14">
            <PushPromptBanner onDismiss={() => { localStorage.setItem("push-prompt-dismissed", "1"); }} />
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
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}>Settle Up</h1>
            {data && <p className="text-sm font-medium text-[var(--text-secondary)] truncate">{data.groupName}</p>}
          </div>
          <button
            onClick={load}
            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-full hover:bg-[var(--paper-dim)]"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-5 w-5 ${isFetching ? "animate-spin" : ""}`} strokeWidth={1.5} />
          </button>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="px-5 flex gap-2 mb-5" role="tablist">
          {(["overview", "pending"] as Screen[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={screen === s}
              onClick={() => setScreen(s)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors border flex items-center gap-2 ${
                screen === s
                  ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                  : "bg-transparent border-[var(--border-dark)] text-[var(--text-secondary)]"
              }`}
            >
              {s === "overview" ? "Who pays whom" : "Awaiting confirmation"}
              {s === "pending" && pendingSettlements.length > 0 && (
                <span
                  className={`text-[11px] font-bold rounded-full px-1.5 min-w-[18px] text-center ${
                    screen === s ? "bg-white/25 text-white" : "bg-[var(--accent)] text-white"
                  }`}
                >
                  {pendingSettlements.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {notice && (
          <div role="status" className="mx-5 mb-4 card p-3 text-sm font-medium text-[var(--text-primary)] flex gap-2">
            <Sparkles className="h-4 w-4 flex-shrink-0 mt-0.5 text-[var(--accent)]" />
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss"><X className="h-4 w-4 text-[var(--text-muted)]" /></button>
          </div>
        )}

        {loading ? (
          <div className="px-5 space-y-4" aria-busy="true">
            <div className="h-36 rounded-[var(--radius-lg)] bg-[var(--paper-dim)] animate-pulse" />
            <div className="h-52 rounded-[var(--radius-lg)] bg-[var(--paper-dim)] animate-pulse" />
            <div className="h-24 rounded-[var(--radius-lg)] bg-[var(--paper-dim)] animate-pulse" />
          </div>
        ) : screen === "overview" ? (
          <div className="px-5 space-y-6 animate-in pb-8">
            {/* ── Hero: where do I stand? ─────────────────────────────────── */}
            <section
              className="card p-5"
              style={{ borderLeft: `4px solid ${iOwe ? "var(--negative)" : iAmOwed ? "var(--positive)" : "var(--border-dark)"}` }}
            >
              <p className="text-[13px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                {iOwe ? "You owe" : iAmOwed ? "You are owed" : allTransfers.length > 0 ? "You're all clear" : "All settled up"}
              </p>
              {my && (iOwe || iAmOwed) ? (
                <AnimatedAmount
                  value={parseFloat(my.netAmount)}
                  className="block text-4xl font-bold tabular-nums mt-1"
                  style={{ color: iOwe ? "var(--negative)" : "var(--positive)" }}
                />
              ) : (
                <p className="text-lg font-semibold text-[var(--text-primary)] mt-1 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-[var(--positive)]" />
                  {allTransfers.length > 0
                    ? `${allTransfers.length} payment${allTransfers.length > 1 ? "s" : ""} pending between others`
                    : "Nobody owes anything"}
                </p>
              )}
              {allTransfers.length > 0 && (
                <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)]">
                  <Sparkles className="h-3.5 w-3.5" />
                  {saved > 0
                    ? `Simplified: ${allTransfers.length} payment${allTransfers.length > 1 ? "s" : ""} instead of up to ${naive}`
                    : `${allTransfers.length} payment${allTransfers.length > 1 ? "s" : ""} to settle everything`}
                </p>
              )}
              <SettleProgress settled={settledSoFar} outstanding={outstanding} />
            </section>

            {/* ── The diagram: who pays whom ──────────────────────────────── */}
            <SettleFlow
              payments={payments}
              meId={user?.id}
              placeholderIds={placeholderIds}
              renderActions={flowActions}
            />

            {allTransfers.length === 0 ? (
              <section className="card overflow-hidden text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/illustrations/settled-celebration.webp"
                  alt="Friends celebrating that everything is settled"
                  width={900}
                  height={600}
                  className="h-auto w-full"
                />
                <div className="p-5">
                  <h2 className="text-xl font-bold text-[var(--text-primary)]">All settled up!</h2>
                  <p className="mt-1 text-sm font-medium text-[var(--text-secondary)]">
                    Nobody owes anything in {data?.groupName ?? "this group"}. Nice teamwork.
                  </p>
                </div>
              </section>
            ) : (
              <>
                {/* ── You pay ─────────────────────────────────────────────── */}
                {myOutgoing.length > 0 && (
                  <section>
                    <h2 className="section-label mb-3">You pay</h2>
                    <div className="space-y-3">
                      {myOutgoing.map((t) => (
                        <div key={keyOf(t)} className="card p-4">
                          <div className="flex items-center gap-3 mb-4">
                            <PersonAvatar name={t.toName} />
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-[var(--text-primary)] truncate">{t.toName}</p>
                              <p className="text-xs text-[var(--text-secondary)] font-medium">Your share to settle</p>
                            </div>
                            <p className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{rupees(t.amount)}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => initiateSettlement(t, "upi")}
                              disabled={busyKey !== null}
                              className="btn-primary flex-[2] flex items-center justify-center gap-2 py-3 text-sm disabled:opacity-50"
                            >
                              <CreditCard className="h-4 w-4" strokeWidth={1.8} />
                              {busyKey === `${keyOf(t)}-upi` ? "Opening UPI…" : `Pay ${rupees(t.amount)} via UPI`}
                            </button>
                            <button
                              onClick={() => initiateSettlement(t, "cash")}
                              disabled={busyKey !== null}
                              className="btn-secondary flex-1 flex items-center justify-center gap-2 py-3 text-sm disabled:opacity-50"
                            >
                              <Banknote className="h-4 w-4" strokeWidth={1.8} />
                              {busyKey === `${keyOf(t)}-cash` ? "…" : "Paid cash"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* ── You'll receive ──────────────────────────────────────── */}
                {myIncoming.length > 0 && (
                  <section>
                    <h2 className="section-label mb-3">You&apos;ll receive</h2>
                    <div className="space-y-3">
                      {myIncoming.map((t) => (
                        <div key={keyOf(t)} className="card p-4">
                          <div className="flex items-center gap-3">
                            <PersonAvatar name={t.fromName} />
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-[var(--text-primary)] truncate">{t.fromName}</p>
                              <p className="text-xs text-[var(--text-secondary)] font-medium">
                                {isPlaceholder(t.from) ? "Not on Spenit yet" : "You confirm once you receive it"}
                              </p>
                            </div>
                            <p className="text-xl font-bold tabular-nums text-[var(--positive)]">{rupees(t.amount)}</p>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => openWhatsApp(remindMessage({ name: t.fromName, groupName: data?.groupName ?? "the group", amount: t.amount }))}
                              className="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm"
                            >
                              <MessageCircle className="h-4 w-4 text-[var(--positive)]" strokeWidth={1.8} />
                              Remind on WhatsApp
                            </button>
                            {isAdmin && isPlaceholder(t.from) && (
                              <button
                                onClick={() => recordOnBehalf(t)}
                                disabled={busyKey !== null}
                                className="btn-secondary flex-1 flex items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-50"
                              >
                                <Banknote className="h-4 w-4" strokeWidth={1.8} />
                                Mark paid
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {confirmedSettlements.length > 0 && (
              <section>
                <h2 className="section-label mb-3">Recently settled</h2>
                <div className="card divide-y divide-[var(--hairline)] overflow-hidden">
                  {confirmedSettlements.slice(0, 3).map((s) => (
                    <div key={s.id} className="p-4 flex items-center gap-3">
                      <Check className="h-5 w-5 flex-shrink-0 text-[var(--positive)]" strokeWidth={1.8} />
                      <p className="text-sm flex-1 font-medium text-[var(--text-secondary)]">
                        <span className="text-[var(--text-primary)]">{s.fromUser.name}</span> paid{" "}
                        <span className="text-[var(--text-primary)]">{s.toUser.name}</span>
                      </p>
                      <span className="font-semibold text-[var(--text-primary)] tabular-nums text-sm">{rupees(s.amount)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="px-5 space-y-4 animate-in pb-8">
            {pendingSettlements.length === 0 ? (
              <EmptyState type="all-settled" title="Nothing waiting" description="No payments are waiting for confirmation." />
            ) : pendingSettlements.map((s) => (
              <div key={s.id} className={`card p-5 ${s.isIncoming ? "card-accent-positive" : ""}`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      {s.isOutgoing ? (
                        <>You <span className="text-[var(--text-muted)] mx-1">→</span> {s.toUser.name}</>
                      ) : s.isIncoming ? (
                        <>{s.fromUser.name} <span className="text-[var(--text-muted)] mx-1">→</span> You</>
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

                {(s.canRespond ?? s.isIncoming) && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => respond(s.id, "confirm")}
                      disabled={confirming === s.id}
                      className="btn-primary flex-1 flex items-center justify-center gap-2 py-3 text-sm disabled:opacity-50"
                      style={{ background: "var(--positive)", boxShadow: "none" }}
                    >
                      <Check className="h-4 w-4" strokeWidth={1.8} />
                      {confirming === s.id ? "Confirming…" : "I received this"}
                    </button>
                    <button
                      onClick={() => respond(s.id, "reject")}
                      disabled={confirming === s.id}
                      aria-label="Reject: I did not receive this"
                      className="btn-secondary flex-shrink-0 flex items-center justify-center py-3 px-4 text-sm disabled:opacity-50 text-[var(--negative)]"
                    >
                      <X className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                  </div>
                )}
                {s.isOutgoing && !s.canRespond && (
                  <p className="text-xs text-[var(--text-secondary)] font-medium text-center">
                    Your balance clears once {s.toUser.name} confirms they received it.
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
