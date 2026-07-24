"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import {
  RefreshCw,
  Scale,
  ArrowRightLeft,
  Link as LinkIcon,
  Copy,
  Check,
  Sparkles,
  X,
  Plus,
  Trash2,
  ShieldCheck
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import PushPromptBanner from "@/components/PushPromptBanner";
import { Card } from "@/components/ui/Card";
import { BalanceAmount } from "@/components/ui/BalanceAmount";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { CategoryIcon } from "@/components/ui/CategoryIcon";

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
  category?: string;
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

  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<{ answer: string; filters?: { categories?: string[]; userIds?: string[] } } | null>(null);

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

  const filteredExpenses = expenses.filter(exp => {
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
  });

  if (!authed) return null;
  if (loading) return (
    <>
      <main className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--ink)" }}>
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
      <main className="min-h-screen page-content pb-24" style={{ backgroundColor: "var(--ink)" }}>
        <PageHeader 
          title={group.name} 
          subtitle={`${group.members.length} member${group.members.length !== 1 ? "s" : ""} · ${group.myRole === "admin" ? "You're admin" : "Member"}`}
          onBack={() => router.back()}
          rightAction={
            <button onClick={loadData} aria-label="Refresh" style={{ color: "var(--text-muted)" }}>
              <RefreshCw className="h-5 w-5" strokeWidth={1.5} />
            </button>
          }
        />

        {showPushPrompt && (
          <PushPromptBanner
            onDismiss={() => {
              setShowPushPrompt(false);
              localStorage.setItem("push-prompt-dismissed", "1");
            }}
          />
        )}

        <div className="px-4 pb-4 flex gap-2 overflow-x-auto">
          <Link href={`/groups/${id}/balance`} className="btn-secondary flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm rounded-[var(--radius-md)]">
            <Scale className="h-4 w-4" strokeWidth={1.5} />
            Balance
          </Link>
          <Link href={`/groups/${id}/settle`} className="btn-secondary flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm rounded-[var(--radius-md)]">
            <ArrowRightLeft className="h-4 w-4" strokeWidth={1.5} />
            Settle Up
          </Link>
          <button onClick={() => setShowInvite(!showInvite)} className="btn-secondary flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm rounded-[var(--radius-md)]">
            <LinkIcon className="h-4 w-4" strokeWidth={1.5} />
            Invite
          </button>
        </div>

        {showInvite && (
          <div className="px-4 mb-4 animate-in">
            <Card padding="md">
              <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-primary)" }}>
                Invite link
              </h3>
              <div className="flex gap-2 mb-4">
                <code className="flex-1 truncate px-3 py-2 text-xs font-mono rounded-[var(--radius-sm)]" style={{ backgroundColor: "var(--paper-dim)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                  {inviteUrl}
                </code>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(inviteUrl);
                    setCopied(true); setTimeout(() => setCopied(false), 2000);
                  }}
                  className="btn-secondary flex-shrink-0 px-3 py-2 rounded-[var(--radius-sm)]"
                >
                  {copied ? <Check className="h-4 w-4" strokeWidth={1.5} /> : <Copy className="h-4 w-4" strokeWidth={1.5} />}
                </button>
              </div>
              <div className="flex justify-center">
                <div style={{ padding: "12px", backgroundColor: "var(--paper)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
                  <QRCodeSVG value={inviteUrl} size={120} bgColor="transparent" fgColor="var(--text-primary)" level="M" />
                </div>
              </div>
            </Card>
          </div>
        )}

        <div className="px-4 grid grid-cols-2 gap-3 mb-5">
          <Card padding="md">
            <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Total spent</p>
            <p className="text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
              ₹{totalSpend.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </Card>
          <Card padding="md">
            <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Expenses</p>
            <p className="text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
              {expenses.length}
            </p>
          </Card>
        </div>

        <div className="px-4 mb-5">
          <form onSubmit={askAI} className="relative">
            <div style={{ position: "relative" }}>
              <input
                type="text"
                placeholder="Ask: “Show food expenses”..."
                value={aiQuery}
                onChange={e => setAiQuery(e.target.value)}
                className="input-field w-full pl-10 pr-12 py-3 text-sm"
              />
              <div className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }}>
                <Sparkles className="h-4 w-4" strokeWidth={1.5} />
              </div>
              <button
                type="submit"
                disabled={aiLoading || !aiQuery.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-[var(--radius-sm)] transition-colors disabled:opacity-40"
                style={{ color: "var(--accent)" }}
                aria-label="Ask AI"
              >
                {aiLoading ? <div className="spinner" style={{ width: "16px", height: "16px", borderWidth: "2px" }} /> : <Sparkles className="h-4 w-4" strokeWidth={1.5} />}
              </button>
            </div>
          </form>

          {aiResponse && (
            <div className="mt-3 animate-in">
              <Card padding="md" style={{ backgroundColor: "var(--paper-dim)", position: "relative" }}>
                <button
                  onClick={() => { setAiResponse(null); setAiQuery(""); }}
                  className="absolute top-2 right-2 transition-colors"
                  style={{ color: "var(--text-muted)" }}
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
                <div className="flex gap-2 pr-6">
                  <Sparkles className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: "var(--accent)" }} strokeWidth={1.5} />
                  <div>
                    <p className="text-sm" style={{ color: "var(--text-primary)" }}>{aiResponse.answer}</p>
                    {aiResponse.filters && Object.keys(aiResponse.filters).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {aiResponse.filters.categories?.map(c => (
                          <span key={c} className="px-2 py-0.5 text-xs rounded-[var(--radius-sm)]" style={{ backgroundColor: "var(--paper)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>

        <div className="px-4 mb-8">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>EXPENSES</SectionLabel>
            <div className="flex items-center gap-2">
              <Link href={`/groups/${id}/expenses/new`} className="text-xs font-medium px-2 py-1" style={{ color: "var(--text-muted)" }}>
                Manual
              </Link>
              <Link href={`/groups/${id}/expenses/ai`} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-sm)]">
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
                Add
              </Link>
            </div>
          </div>

          {filteredExpenses.length === 0 ? (
            <EmptyState 
              type="no-expenses" 
              title="No expenses yet" 
              description="Add the first expense and splits will be calculated automatically"
              action={
                <div className="flex gap-2 mt-4">
                  <Link href={`/groups/${id}/expenses/ai`} className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm rounded-[var(--radius-md)]">
                    <Sparkles className="h-4 w-4" strokeWidth={1.5} />
                    Add with AI
                  </Link>
                  <Link href={`/groups/${id}/expenses/new`} className="btn-secondary flex items-center px-4 py-2 text-sm rounded-[var(--radius-md)]">
                    Manual
                  </Link>
                </div>
              }
            />
          ) : (
            <Card padding="none">
              <div className="flex flex-col">
                {filteredExpenses.map((exp, i) => (
                  <div key={exp.id} className="p-3 flex items-start gap-3" style={{ borderBottom: i < filteredExpenses.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div className="mt-0.5 flex-shrink-0">
                      <CategoryIcon category={exp.category ?? null} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{exp.description}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {new Date(exp.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        {" · "}{exp.splitType} split
                        {exp.payers.length > 0 && ` · ${exp.payers.map(p => p.name).join(", ")} paid`}
                      </p>
                      {exp.splits.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {exp.splits.map((s) => (
                            <span
                              key={s.userId}
                              className="text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)]"
                              style={{ backgroundColor: "var(--paper-dim)", color: "var(--text-secondary)" }}
                            >
                              {s.name} ₹{parseFloat(s.shareAmount).toFixed(0)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <BalanceAmount amount={exp.amount} direction="settled" variant="compact" />
                      <button
                        onClick={() => deleteExpense(exp.id)}
                        disabled={deletingId === exp.id}
                        className="p-1 transition-colors disabled:opacity-30"
                        style={{ color: "var(--text-muted)" }}
                        aria-label="Delete expense"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="px-4 pb-8">
          <SectionLabel className="mb-3">MEMBERS ({group.members.length})</SectionLabel>
          <Card padding="none">
            <div className="flex flex-col">
              {group.members.map((m, i) => (
                <div key={m.id} className="p-3 flex items-center gap-3" style={{ borderBottom: i < group.members.length - 1 ? "1px solid var(--border)" : "none" }}>
                  {m.avatarUrl ? (
                    <Image src={m.avatarUrl} alt={m.name} width={36} height={36} className="rounded-full flex-shrink-0" />
                  ) : (
                    <div
                      className="h-9 w-9 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0"
                      style={{ backgroundColor: "var(--accent)", color: "var(--paper)" }}
                    >
                      {m.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                      {m.name}{m.id === user?.id ? " (you)" : ""}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>@{m.username}</p>
                  </div>
                  {m.role === "admin" && (
                    <span
                      className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-[var(--radius-sm)]"
                      style={{ backgroundColor: "var(--paper-dim)", color: "var(--text-secondary)" }}
                    >
                      <ShieldCheck className="h-3 w-3" strokeWidth={1.5} />
                      Admin
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </main>
      <BottomNav />
    </>
  );
}