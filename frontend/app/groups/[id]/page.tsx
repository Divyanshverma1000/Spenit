"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import PushPromptBanner from "@/components/PushPromptBanner";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface Member {
  id: string; name: string; username: string; avatarUrl: string | null; role: string;
}
interface Payer {
  userId: string; name: string; amountPaid: string;
}
interface Split {
  userId: string; name: string; shareAmount: string;
}
interface Expense {
  id: string; description: string; amount: string; currency: string;
  splitType: string; createdAt: string; payers: Payer[]; splits: Split[];
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
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // AI Query state
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<{ answer: string; filters?: { categories?: string[]; userIds?: string[] } } | null>(null);

  // Push prompt: show after user has expenses (contextual, not on first load)
  const [showPushPrompt, setShowPushPrompt] = useState(false);

  const loadData = useCallback(async () => {
    if (!accessToken || !id) return;
    Promise.all([
      fetch(`${API_URL}/groups/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`${API_URL}/expenses?groupId=${id}`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]).then(async ([gRes, eRes]) => {
      if (!gRes.ok) { router.replace("/groups"); return; }
      const [gData, eData] = await Promise.all([gRes.json(), eRes.ok ? eRes.json() : []]);
      setGroup(gData); setExpenses(eData);
      if (eData.length > 0 && typeof window !== "undefined") {
        const dismissed = localStorage.getItem("push-prompt-dismissed");
        if (!dismissed && Notification.permission === "default") {
          setShowPushPrompt(true);
        }
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, [accessToken, id, router]);

  // Initial load
  useEffect(() => { loadData(); }, [loadData]);

  // 30s polling — keeps expenses and balances fresh without hard refresh
  useEffect(() => {
    const interval = setInterval(() => { loadData(); }, 30_000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Refresh when tab becomes visible again (switching back from another tab/app)
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

  const filteredExpenses = expenses.filter(exp => {
    if (!aiResponse?.filters) return true;
    const { categories, userIds } = aiResponse.filters;
    
    let match = true;
    if (categories && categories.length > 0) {
      match = match && categories.includes(exp.category);
    }
    if (userIds && userIds.length > 0) {
      // Check if any of the userIds are involved as payer or participant
      const involvedIds = new Set([
        ...exp.payers.map(p => p.userId),
        ...exp.splits.map(s => s.userId)
      ]);
      const hasUserMatch = userIds.some(uid => involvedIds.has(uid));
      match = match && hasUserMatch;
    }
    return match;
  });

  if (!authed) return null;
  if (loading) return (
    <>
      <main className="min-h-screen bg-[#0a0a12] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
      </main>
      <BottomNav />
    </>
  );
  if (!group) return null;

  const inviteUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/g/${group.inviteToken}`;
  const totalSpend = expenses.reduce((a, e) => a + parseFloat(e.amount), 0);

  return (
    <>
      <main className="min-h-screen bg-[#0a0a12] page-content">
        {/* Header */}
        <div className="px-5 pt-14 pb-2 flex items-start gap-3">
          <button onClick={() => router.back()} className="mt-1 flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{group.icon || "👥"}</span>
              <h1 className="text-xl font-bold text-white truncate">{group.name}</h1>
            </div>
            <p className="text-slate-500 text-xs mt-0.5">
              {group.members.length} member{group.members.length !== 1 ? "s" : ""} · {group.myRole === "admin" ? "You're admin" : "Member"}
            </p>
          </div>
          {/* Manual refresh button — data also auto-refreshes every 30s */}
          <button
            onClick={loadData}
            className="flex-shrink-0 mt-1 text-slate-600 hover:text-slate-400 transition-colors p-1"
            title="Refresh"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Push notification prompt — only shown when group has expenses and user hasn't enabled/dismissed */}
        {showPushPrompt && (
          <PushPromptBanner
            onDismiss={() => {
              setShowPushPrompt(false);
              localStorage.setItem("push-prompt-dismissed", "1");
            }}
          />
        )}

        {/* ── Action buttons ─────────────────────────────────────────────────── */}
        <div className="px-5 pb-4 flex gap-2 mt-3 overflow-x-auto">
          <Link href={`/groups/${id}/balance`}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-300 active:scale-95 transition-transform">
            ⚖️ Balance
          </Link>
          <Link href={`/groups/${id}/settle`}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-xs font-semibold text-violet-300 active:scale-95 transition-transform">
            💸 Settle Up
          </Link>
          <button onClick={() => setShowInvite(!showInvite)}
            className="flex-shrink-0 flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-slate-400 active:scale-95 transition-transform">
            🔗 Invite
          </button>
        </div>

        {/* Invite panel */}
        {showInvite && (
          <div className="mx-5 mb-4 glass-card p-5 space-y-4 animate-in">
            <h3 className="text-sm font-semibold text-white">Invite link</h3>
            <div className="flex gap-2">
              <code className="flex-1 truncate rounded-xl bg-black/40 border border-white/5 px-3 py-2 text-xs text-violet-300">
                {inviteUrl}
              </code>
              <button onClick={async () => {
                await navigator.clipboard.writeText(inviteUrl);
                setCopied(true); setTimeout(() => setCopied(false), 2000);
              }} className="flex-shrink-0 rounded-xl bg-violet-600/20 border border-violet-500/30 px-3 py-2 text-xs text-violet-300">
                {copied ? "✓" : "Copy"}
              </button>
            </div>
            <div className="flex justify-center">
              <div className="bg-white p-3 rounded-xl">
                <QRCodeSVG value={inviteUrl} size={130} bgColor="#ffffff" fgColor="#0a0a12" level="M" />
              </div>
            </div>
          </div>
        )}

        {/* ── Stats ─────────────────────────────────────────────────────────── */}
        <div className="px-5 grid grid-cols-2 gap-3 mb-5">
          <div className="glass-card p-4">
            <p className="text-xs text-slate-500 mb-1">Total spent</p>
            <p className="text-xl font-bold text-white">
              ₹{totalSpend.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="glass-card p-4">
            <p className="text-xs text-slate-500 mb-1">Expenses</p>
            <p className="text-xl font-bold text-white">{expenses.length}</p>
          </div>
        </div>

        {/* ── Ask AI / Smart Search ─────────────────────────────────────────── */}
        <div className="px-5 mb-5">
          <form onSubmit={askAI} className="relative">
            <input
              type="text"
              placeholder="Ask AI: e.g., 'Show food expenses' or 'Who owes me the most?'"
              value={aiQuery}
              onChange={e => setAiQuery(e.target.value)}
              className="w-full rounded-2xl border border-fuchsia-500/30 bg-black/40 pl-4 pr-12 py-3.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-fuchsia-500/70 transition-colors"
            />
            <button
              type="submit"
              disabled={aiLoading || !aiQuery.trim()}
              className="absolute right-2 top-2 bottom-2 aspect-square rounded-xl bg-fuchsia-600/20 text-fuchsia-400 flex items-center justify-center disabled:opacity-50"
            >
              {aiLoading ? (
                <div className="h-4 w-4 rounded-full border-2 border-fuchsia-500 border-t-transparent animate-spin" />
              ) : "✨"}
            </button>
          </form>

          {aiResponse && (
            <div className="mt-3 p-4 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/5 relative">
              <button 
                onClick={() => { setAiResponse(null); setAiQuery(""); }}
                className="absolute top-2 right-2 text-slate-500 hover:text-slate-300"
              >
                ✕
              </button>
              <div className="flex gap-3">
                <span className="text-xl">🤖</span>
                <div>
                  <p className="text-sm text-slate-200 leading-relaxed">{aiResponse.answer}</p>
                  {aiResponse.filters && Object.keys(aiResponse.filters).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {aiResponse.filters.categories?.map(c => (
                        <span key={c} className="px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 text-xs font-medium">Category: {c}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Expenses ──────────────────────────────────────────────────────── */}
        <div className="px-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Expenses</h2>
            <div className="flex items-center gap-2">
              <Link href={`/groups/${id}/expenses/new`}
                className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/10 transition-colors active:scale-95">
                Manual
              </Link>
              <Link href={`/groups/${id}/expenses/ai`}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 active:scale-95 transition-transform">
                <span>✨</span> Add
              </Link>
            </div>
          </div>

          {filteredExpenses.length === 0 ? (
            <div className="glass-card p-8 text-center">
              <p className="text-3xl mb-3">🧾</p>
              <p className="text-slate-400 font-medium mb-1">No expenses yet</p>
              <p className="text-slate-600 text-sm mb-5">Add the first expense and splits will be calculated automatically</p>
              <div className="flex gap-3 justify-center">
                <Link href={`/groups/${id}/expenses/ai`}
                  className="btn-primary inline-flex items-center gap-1.5 px-5 py-2.5 text-sm">
                  <span>✨</span> Add with AI
                </Link>
                <Link href={`/groups/${id}/expenses/new`}
                  className="inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-400 hover:bg-white/10 transition-colors">
                  Manual
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredExpenses.map((exp) => (
                <div key={exp.id} className="glass-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate">{exp.description}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {new Date(exp.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        {" · "}{exp.splitType} split
                        {exp.payers.length > 0 && ` · ${exp.payers.map(p => p.name).join(", ")} paid`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-white font-bold">
                        ₹{parseFloat(exp.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                      <button onClick={() => deleteExpense(exp.id)}
                        disabled={deletingId === exp.id}
                        className="text-slate-700 hover:text-rose-400 transition-colors text-xl leading-none disabled:opacity-30">
                        ×
                      </button>
                    </div>
                  </div>
                  {exp.splits.length > 0 && (
                    <div className="mt-2.5 pt-2.5 border-t border-white/5 flex flex-wrap gap-1.5">
                      {exp.splits.map((s) => (
                        <span key={s.userId} className="text-xs bg-white/5 border border-white/8 rounded-full px-2 py-0.5 text-slate-400">
                          {s.name} ₹{parseFloat(s.shareAmount).toFixed(2)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Members ───────────────────────────────────────────────────────── */}
        <div className="px-5 mt-5">
          <h2 className="text-sm font-semibold text-white mb-3">Members ({group.members.length})</h2>
          <div className="glass-card p-4 space-y-3">
            {group.members.map((m) => (
              <div key={m.id} className="flex items-center gap-3">
                {m.avatarUrl ? (
                  <Image src={m.avatarUrl} alt={m.name} width={36} height={36} className="rounded-full flex-shrink-0" />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {m.name}{m.id === user?.id ? " (you)" : ""}
                  </p>
                  <p className="text-xs text-slate-500">@{m.username}</p>
                </div>
                {m.role === "admin" && (
                  <span className="text-xs bg-violet-500/20 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full">
                    Admin
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
