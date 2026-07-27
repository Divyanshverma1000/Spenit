"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  MoreVertical,
  RefreshCw,
  Scale,
  ArrowRightLeft,
  Link as LinkIcon,
  Copy,
  Check,
  Sparkles,
  X,
  ShieldCheck
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import PushPromptBanner from "@/components/PushPromptBanner";
import { BalanceAmount } from "@/components/ui/BalanceAmount";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExpenseDetailModal } from "@/components/ExpenseDetailModal";
import { SettlementRow, Settlement } from "@/components/ui/SettlementRow";
import { SummaryGrid } from "@/components/ui/SummaryGrid";
import { ExpenseRow, Expense } from "@/components/ui/ExpenseRow";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface Member {
  id: string; name: string; username: string; avatarUrl: string | null; role: string;
}

interface GroupDetail {
  id: string; name: string; icon: string | null; inviteToken: string;
  createdBy: string; myRole: string; members: Member[];
}

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const { accessToken, user } = useAuth();
  const router = useRouter();
  
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);

  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<{ answer: string; filters?: { categories?: string[]; userIds?: string[] } } | null>(null);

  const [showPushPrompt, setShowPushPrompt] = useState(false);
  
  // My Balance in this group
  const [myBalance, setMyBalance] = useState<{ netAmount: string, direction: "owed" | "owes" | "settled" } | null>(null);

  const loadData = useCallback(async () => {
    if (!accessToken || !id) return;
    Promise.all([
      fetch(`${API_URL}/groups/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`${API_URL}/expenses?groupId=${id}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`${API_URL}/settlements?groupId=${id}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`${API_URL}/balance/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
    ]).then(async ([gRes, eRes, sRes, bRes]) => {
      if (!gRes.ok) { router.replace("/groups"); return; }
      const [gData, eData, sData, bData] = await Promise.all([
        gRes.json(), 
        eRes.ok ? eRes.json() : [], 
        sRes.ok ? sRes.json() : [], 
        bRes.ok ? bRes.json() : null
      ]);
      setGroup(gData); 
      setExpenses(eData);
      setSettlements(sData);
      
      if (bData && bData.breakdown) {
        const groupBalance = bData.breakdown.find((b: any) => b.groupId === id);
        if (groupBalance) {
          setMyBalance({ netAmount: groupBalance.netAmount, direction: groupBalance.direction });
        } else {
          setMyBalance({ netAmount: "0", direction: "settled" });
        }
      }

      if (eData.length > 0 && typeof window !== "undefined") {
        const dismissed = localStorage.getItem("push-prompt-dismissed");
        if (!dismissed && Notification.permission === "default") {
          setShowPushPrompt(true);
        }
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, [accessToken, id, router]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const interval = setInterval(() => { loadData(); }, 30_000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadData(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadData]);

  async function deleteExpense(expenseId: string) {
    if (!confirm("Delete this expense?")) return;
    setDeletingId(expenseId);
    await fetch(`${API_URL}/expenses/${expenseId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(console.error);
    setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
    setDeletingId(null);
  }

  async function askAI(e: React.FormEvent) {
    e.preventDefault();
    if (!aiQuery.trim() || !accessToken) return;

    setAiLoading(true);
    setAiResponse(null);
    try {
      const res = await fetch(`${API_URL}/ai/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: id, question: aiQuery })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "missing_key") {
          alert("Please set your Groq API Key in Profile settings first.");
          router.push("/profile");
          return;
        }
        throw new Error(data.error || "Failed to query AI");
      }
      setAiResponse(data);
    } catch (err: any) {
      console.error(err);
      alert(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  const feedItems = useMemo(() => {
    const filteredExp = expenses.filter(exp => {
      if (!aiResponse?.filters) return true;
      const { categories, userIds } = aiResponse.filters;

      let match = true;
      if (categories && categories.length > 0) {
        match = match && !!exp.category && categories.includes(exp.category);
      }
      if (userIds && userIds.length > 0) {
        const involvedIds = new Set([
          ...exp.payers.map(p => p.userId),
          ...exp.splits.map(s => s.userId)
        ]);
        const hasUserMatch = userIds.some(uid => involvedIds.has(uid));
        match = match && hasUserMatch;
      }
      return match;
    }).map(e => ({ type: 'expense' as const, data: e, createdAt: new Date(e.createdAt).getTime() }));

    const filteredSet = aiResponse?.filters 
      ? [] // hide settlements if AI filtering is active
      : settlements.map(s => ({ type: 'settlement' as const, data: s, createdAt: new Date(s.createdAt).getTime() }));

    return [...filteredExp, ...filteredSet].sort((a, b) => b.createdAt - a.createdAt);
  }, [expenses, settlements, aiResponse]);

  if (!authed) return null;
  if (loading && !group) return (
    <>
      <main className="min-h-screen flex items-center justify-center bg-[var(--ink)]">
        <div className="spinner" />
      </main>
      <BottomNav />
    </>
  );
  if (!group) return null;

  const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/g/${group.inviteToken}`;
  const totalSpend = expenses.reduce((a, e) => a + parseFloat(e.amount), 0);

  return (
    <>
      <main className="min-h-screen page-content pb-24 bg-[var(--ink)]">
        
        {/* ── Sticky Premium Context Header ────────────────────────────────────────── */}
        <div className="sticky top-0 z-20 bg-[var(--ink)]/80 backdrop-blur-xl px-5 pt-14 pb-4 border-b border-[rgba(0,0,0,0.03)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => router.back()} className="h-10 w-10 flex items-center justify-center bg-white rounded-full shadow-sm border border-[rgba(0,0,0,0.02)] active:scale-95 transition-transform">
                <ChevronLeft size={20} className="text-[var(--text-primary)]" />
              </button>
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-[12px] bg-[var(--paper-dim)] text-[var(--accent)] flex items-center justify-center text-[16px] font-bold">
                  {group.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h1 className="text-[18px] font-bold text-[var(--text-primary)] tracking-tight leading-tight">{group.name}</h1>
                  <p className="text-[13px] font-medium text-[var(--text-secondary)]">{group.members.length} members</p>
                </div>
              </div>
            </div>
            <button className="h-10 w-10 flex items-center justify-center text-[var(--text-secondary)] active:scale-95 transition-transform">
              <MoreVertical size={20} />
            </button>
          </div>
        </div>

        {/* ── Action Pills ────────────────────────────────────────── */}
        <div className="px-5 py-4 flex gap-2 overflow-x-auto hide-scrollbar sticky top-[88px] z-10 bg-[var(--ink)]/90 backdrop-blur-sm">
          <Link href={`/groups/${id}/balance`} className="bg-white border border-[rgba(0,0,0,0.03)] shadow-sm flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-[14px] font-semibold rounded-full active:scale-95 transition-transform">
            <Scale className="h-4 w-4 text-[var(--accent)]" strokeWidth={2} />
            Balance
          </Link>
          <Link href={`/groups/${id}/settle`} className="bg-white border border-[rgba(0,0,0,0.03)] shadow-sm flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-[14px] font-semibold rounded-full active:scale-95 transition-transform">
            <ArrowRightLeft className="h-4 w-4 text-[var(--accent)]" strokeWidth={2} />
            Settle Up
          </Link>
          <button onClick={() => setShowInvite(!showInvite)} className="bg-white border border-[rgba(0,0,0,0.03)] shadow-sm flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-[14px] font-semibold rounded-full active:scale-95 transition-transform">
            <LinkIcon className="h-4 w-4 text-[var(--accent)]" strokeWidth={2} />
            Invite
          </button>
        </div>

        <AnimatePresence>
          {showInvite && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-5 mb-5 overflow-hidden">
              <div className="bg-white p-5 rounded-[24px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-[rgba(0,0,0,0.03)]">
                <h3 className="text-[14px] font-bold text-[var(--text-primary)] mb-3">Invite link</h3>
                <div className="flex gap-2 mb-4">
                  <code className="flex-1 truncate px-3 py-3 text-[13px] font-mono rounded-[12px] bg-[var(--paper-dim)] text-[var(--text-secondary)] border border-[var(--border)]">
                    {inviteUrl}
                  </code>
                  <button onClick={async () => { await navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="bg-[var(--accent)] text-white flex-shrink-0 px-4 rounded-[12px] font-bold text-[14px] shadow-[0_4px_14px_rgba(245,158,11,0.3)]">
                    {copied ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                </div>
                <div className="flex justify-center">
                  <div className="p-4 bg-[var(--paper-dim)] rounded-[16px]">
                    <QRCodeSVG value={inviteUrl} size={140} bgColor="transparent" fgColor="var(--text-primary)" level="M" />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {showPushPrompt && (
          <PushPromptBanner onDismiss={() => { setShowPushPrompt(false); localStorage.setItem("push-prompt-dismissed", "1"); }} />
        )}

        {/* ── Summary Grid ────────────────────────────────────────── */}
        <div className="px-5">
          <SummaryGrid 
            items={[
              { label: "Spent", value: `₹${totalSpend.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` },
              { label: "Expenses", value: expenses.length },
              { label: "Members", value: group.members.length },
              { 
                label: "Your Balance", 
                value: myBalance ? <BalanceAmount amount={myBalance.netAmount} direction={myBalance.direction} variant="compact" /> : "₹0",
                valueClassName: "mt-1"
              }
            ]}
          />
        </div>

        {/* ── Sticky AI Search ────────────────────────────────────────── */}
        <div className="sticky top-[148px] z-10 bg-[var(--ink)]/90 backdrop-blur-md px-5 py-3 mb-2">
          <form onSubmit={askAI} className="relative">
            <input
              type="text"
              placeholder="Ask Spenit... e.g. Who owes me?"
              value={aiQuery}
              onChange={e => setAiQuery(e.target.value)}
              className="w-full bg-white rounded-[14px] pl-10 pr-12 py-3.5 text-[15px] font-medium text-[var(--text-primary)] shadow-[0_2px_8px_rgba(0,0,0,0.02)] border border-[rgba(0,0,0,0.03)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)] transition-shadow placeholder:text-[var(--text-muted)]"
            />
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
              <Sparkles size={18} strokeWidth={2} />
            </div>
            <button
              type="submit"
              disabled={aiLoading || !aiQuery.trim()}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-[10px] transition-colors disabled:opacity-40 text-[var(--accent)]"
              aria-label="Ask AI"
            >
              {aiLoading ? <div className="spinner-sm" style={{ borderWidth: "2px" }} /> : <Sparkles size={18} strokeWidth={2.5} />}
            </button>
          </form>

          <AnimatePresence>
            {aiResponse && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 overflow-hidden">
                <div className="bg-[var(--accent-subtle)] p-4 rounded-[16px] relative">
                  <button onClick={() => { setAiResponse(null); setAiQuery(""); }} className="absolute top-3 right-3 text-[var(--accent)] opacity-70 hover:opacity-100">
                    <X size={16} strokeWidth={2} />
                  </button>
                  <div className="flex gap-2.5 pr-6">
                    <Sparkles size={16} className="flex-shrink-0 mt-0.5 text-[var(--accent)]" strokeWidth={2} />
                    <div>
                      <p className="text-[14px] font-semibold text-[var(--text-primary)] leading-snug">{aiResponse.answer}</p>
                      {aiResponse.filters && Object.keys(aiResponse.filters).length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {aiResponse.filters.categories?.map(c => (
                            <span key={c} className="px-2 py-1 text-[11px] font-bold rounded-[8px] bg-white text-[var(--text-secondary)] shadow-sm uppercase tracking-wider">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Expenses ────────────────────────────────────────── */}
        <div className="px-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>EXPENSES</SectionLabel>
            <div className="flex items-center gap-2">
              <Link href={`/groups/${id}/expenses/new`} className="text-[13px] font-bold text-[var(--text-secondary)] px-3 py-1.5 active:scale-95 transition-transform">
                Manual
              </Link>
              <Link href={`/groups/${id}/expenses/ai`} className="bg-[var(--accent)] text-white flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-bold rounded-[12px] shadow-[0_4px_14px_rgba(245,158,11,0.3)] active:scale-95 transition-transform">
                <Sparkles size={14} strokeWidth={2.5} />
                Add
              </Link>
            </div>
          </div>

          {feedItems.length === 0 ? (
            <EmptyState 
              type="no-expenses" 
              title="No expenses yet" 
              description="Add the first expense and splits will be calculated automatically"
              action={{ label: "Add with AI", href: `/groups/${id}/expenses/ai` }}
            />
          ) : (
            <div className="bg-white rounded-[24px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-[rgba(0,0,0,0.03)] overflow-hidden divide-y divide-[rgba(0,0,0,0.03)]">
              {feedItems.map((item) => (
                item.type === 'expense' ? (
                  <ExpenseRow 
                    key={`exp-${item.data.id}`} 
                    expense={item.data as Expense} 
                    onClick={() => setSelectedExpense(item.data as Expense)} 
                  />
                ) : (
                  <SettlementRow 
                    key={`set-${item.data.id}`}
                    settlement={item.data as Settlement} 
                  />
                )
              ))}
            </div>
          )}
        </div>

        {/* ── Members List Rows ────────────────────────────────────────── */}
        <div className="px-5 pb-8">
          <SectionLabel className="mb-3">MEMBERS ({group.members.length})</SectionLabel>
          <div className="bg-white rounded-[24px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-[rgba(0,0,0,0.03)] overflow-hidden divide-y divide-[rgba(0,0,0,0.03)]">
            {group.members.map((m) => (
              <div key={m.id} className="p-4 flex items-center gap-3">
                {m.avatarUrl ? (
                  <Image src={m.avatarUrl} alt={m.name} width={40} height={40} className="rounded-full flex-shrink-0 border border-[rgba(0,0,0,0.05)]" />
                ) : (
                  <div className="h-10 w-10 rounded-full flex items-center justify-center text-[16px] font-bold flex-shrink-0 bg-[var(--paper-dim)] text-[var(--accent)] border border-[rgba(0,0,0,0.02)]">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold tracking-tight text-[var(--text-primary)] truncate">
                    {m.name}{m.id === user?.id ? " (you)" : ""}
                  </p>
                  <p className="text-[13px] font-medium text-[var(--text-secondary)]">@{m.username}</p>
                </div>
                {m.role === "admin" && (
                  <span className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-[8px] bg-[var(--paper-dim)] text-[var(--text-secondary)] uppercase tracking-wider">
                    <ShieldCheck size={12} strokeWidth={2.5} />
                    Admin
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>

      {selectedExpense && (
        <ExpenseDetailModal
          expense={selectedExpense}
          currentUserId={user?.id}
          onClose={() => setSelectedExpense(null)}
          onDelete={async (id) => {
            await deleteExpense(id);
            setSelectedExpense(null);
          }}
          isDeleting={deletingId === selectedExpense.id}
        />
      )}

      <BottomNav />
    </>
  );
}