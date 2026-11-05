"use client";

import { API_URL } from "@/lib/api";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";

// Loaded only when the invite panel is opened (keeps the group screen light).
const QRCodeSVG = dynamic(() => import("qrcode.react").then((m) => m.QRCodeSVG), { ssr: false });
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  RefreshCw,
  Scale,
  ArrowRightLeft,
  Link as LinkIcon,
  Copy,
  Check,
  Sparkles,
  X,
  ShieldCheck,
  Edit2,
  Trash2,
  UserPlus,
  Pencil,
  Share2,
  MessageCircle,
  Clock,
  ExternalLink,
  History,
  LogOut,
  Undo2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useOutbox } from "@/context/OutboxContext";
import { useGroupOverview, groupKey, GroupMember, GroupOverview } from "@/lib/queries";
import type { OutboxItem } from "@/lib/outbox";
import { openWhatsApp, oweMessage, groupSummaryMessage } from "@/lib/share";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import PushPromptBanner from "@/components/PushPromptBanner";
import { BalanceAmount } from "@/components/ui/BalanceAmount";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { EmptyState } from "@/components/ui/EmptyState";
import { ExpenseDetailModal } from "@/components/ExpenseDetailModal";
import AvatarPicker from "@/components/AvatarPicker";
import GroupChat from "@/components/GroupChat";
import ClaimFixSheet from "@/components/ClaimFixSheet";
import MemberAvatar, { AvatarPeople } from "@/components/ui/MemberAvatar";
import { lookAlikes, initials } from "@/lib/avatar";
import { SettlementRow, Settlement } from "@/components/ui/SettlementRow";
import { SummaryGrid } from "@/components/ui/SummaryGrid";
import { ExpenseRow, Expense } from "@/components/ui/ExpenseRow";


type Member = GroupMember;

/** Turn a queued (not yet synced) expense into a list row so it shows up instantly. */
function pendingToExpense(item: OutboxItem, members: GroupMember[]): Expense {
  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.name ?? "Someone";
  const d = item.draft;
  const equalShare = d.participants.length ? d.amount / d.participants.length : 0;
  return {
    id: `pending-${item.id}`,
    description: d.description,
    amount: d.amount.toFixed(2),
    currency: d.currency ?? "INR",
    splitType: d.splitType,
    createdAt: item.createdAt,
    category: d.category ?? undefined,
    payers: d.payers.map((p) => ({ userId: p.userId, name: nameOf(p.userId), amountPaid: p.amountPaid.toFixed(2) })),
    splits: d.participants.map((p) => ({
      userId: p.userId,
      name: nameOf(p.userId),
      shareAmount: (p.shareAmount ?? equalShare).toFixed(2),
    })),
    pending: true,
  };
}

function PendingRow({
  expense, outbox, onRetry, onDiscard,
}: {
  expense: Expense;
  outbox?: OutboxItem;
  onRetry: (id: string) => void;
  onDiscard: (id: string) => void;
}) {
  const failed = outbox?.status === "failed";
  return (
    <div className="opacity-80">
      <ExpenseRow expense={expense} />
      <div className="px-4 pb-3 -mt-1 flex items-center gap-3 text-[12px] font-semibold">
        {failed ? (
          <>
            <span className="text-[var(--negative)] flex-1">Couldn&apos;t save: {outbox?.error}</span>
            <button onClick={() => outbox && onRetry(outbox.id)} className="text-[var(--accent)]">Retry</button>
            <button onClick={() => outbox && onDiscard(outbox.id)} className="text-[var(--text-secondary)]">Discard</button>
          </>
        ) : (
          <span className="text-[var(--text-secondary)] flex items-center gap-1.5">
            <Clock size={12} /> Saved on this phone. Syncing when online
          </span>
        )}
      </div>
    </div>
  );
}

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const { accessToken, user, authFetch } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  // One cached request for the whole screen (group, members, expenses, settlements, balances).
  const { data: overview, isPending, isError, error, refetch } = useGroupOverview(id);
  const { items: outbox, retry: retryOutbox, discard: discardOutbox } = useOutbox();

  const group = overview?.group ?? null;
  const settlements = overview?.settlements ?? [];
  const loading = isPending && !overview;
  const myBalance = overview?.balance?.myBalance ?? null;
  const memberBalances = useMemo(
    () => Object.fromEntries((overview?.balance?.memberBalances ?? []).map((mb) => [mb.userId, mb])),
    [overview]
  );

  const pendingItems = useMemo(
    () => outbox.filter((i) => i.draft.groupId === id),
    [outbox, id]
  );
  const expenses = useMemo(
    () => [
      ...pendingItems.map((i) => pendingToExpense(i, group?.members ?? [])),
      ...(overview?.expenses ?? []),
    ],
    [pendingItems, overview, group]
  );

  const [showInvite, setShowInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);

  // Ask Spenit: a chat sheet; "Show N bills" from an answer filters the list below.
  const [chatOpen, setChatOpen] = useState(false);
  const [aiFilter, setAiFilter] = useState<string[] | null>(null);

  const [showPushPrompt, setShowPushPrompt] = useState(false);

  // Members "sheet": admin tools for people who haven't joined
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  // Fixing a wrong "I'm …" pick (by the person themself, or the admin)
  const [claimFix, setClaimFix] = useState<{ member: GroupMember; asAdmin: boolean } | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  /** whose group avatar is being picked */
  const [avatarFor, setAvatarFor] = useState<GroupMember | null>(null);
  const [editName, setEditName] = useState("");

  const loadData = useCallback(() => refetch(), [refetch]);

  // Not a member / group gone: back to the list (only on a definite answer, never when merely offline).
  useEffect(() => {
    const status = (error as { status?: number } | null)?.status;
    if (isError && (status === 403 || status === 404)) router.replace("/groups");
  }, [isError, error, router]);

  // Offer push notifications once there is something worth being notified about.
  const serverExpenseCount = overview?.expenses.length ?? 0;
  useEffect(() => {
    if (serverExpenseCount > 0 && typeof window !== "undefined" && "Notification" in window) {
      const dismissed = localStorage.getItem("push-prompt-dismissed");
      if (!dismissed && Notification.permission === "default") setShowPushPrompt(true);
    }
  }, [serverExpenseCount]);

  async function deleteExpense(expenseId: string) {
    if (!confirm("Delete this expense?")) return;
    setDeletingId(expenseId);
    // Remove it from the screen immediately; the refetch below corrects balances.
    queryClient.setQueryData<GroupOverview>(groupKey(id), (old) =>
      old ? { ...old, expenses: old.expenses.filter((e) => e.id !== expenseId) } : old
    );
    await authFetch(`/expenses/${expenseId}`, { method: "DELETE" }).catch(console.error);
    await refetch();
    setDeletingId(null);
  }

  /** Create (or reuse) this person's no-sign-in "what you owe" link and send it on WhatsApp. */
  async function shareOweLink(m: GroupMember) {
    setMemberError(null);
    try {
      const res = await authFetch(`/owe/groups/${id}/members/${m.id}/link`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMemberError(data.error || "Couldn't create the link"); return; }
      const bal = memberBalances[m.id];
      // Not joined yet: a personal invite. Opening it says "Join as Ankit", no list to pick from.
      if (m.isPlaceholder && group?.inviteToken) {
        const invite = `${window.location.origin}/g/${group.inviteToken}?as=${encodeURIComponent(data.token)}`;
        const owes = bal && bal.direction === "owes" ? ` You owe ₹${parseFloat(bal.netAmount).toFixed(2)} so far.` : bal && bal.direction === "owed" ? ` You get back ₹${parseFloat(bal.netAmount).toFixed(2)} so far.` : "";
        openWhatsApp(`Hi ${m.name}! I've added you to "${group.name}" on Spenit, where we split our expenses.${owes} Tap to join as ${m.name}: ${invite}`);
        return;
      }
      const url = `${window.location.origin}/owe/${data.token}`;
      openWhatsApp(
        bal && bal.direction === "owes"
          ? oweMessage({ name: m.name, groupName: group?.name ?? "the group", amount: bal.netAmount, url })
          : `Hi ${m.name}! Here is your summary for "${group?.name ?? "the group"}": ${url}`
      );
    } catch { setMemberError("Couldn't reach the server. Check your connection and try again."); }
  }

  function shareGroupSummary() {
    if (!group) return;
    const inviteUrl = `${window.location.origin}/g/${group.inviteToken}`;
    openWhatsApp(
      groupSummaryMessage({
        groupName: group.name,
        transfers: overview?.balance?.simplifiedTransfers ?? [],
        joinUrl: inviteUrl,
      })
    );
  }

  async function addPerson(e: React.FormEvent) {
    e.preventDefault();
    const name = newPersonName.trim();
    if (!name) return;
    setMemberBusy(true); setMemberError(null);
    try {
      const res = await authFetch(`/groups/${id}/members`, {
        method: "POST", body: JSON.stringify({ nickname: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMemberError(data.error || "Couldn't add that person"); return; }
      setNewPersonName(""); setShowAddPerson(false);
      await loadData();
    } catch { setMemberError("Network error. Please try again."); }
    finally { setMemberBusy(false); }
  }

  async function saveNickname(memberId: string) {
    setMemberBusy(true); setMemberError(null);
    try {
      const res = await authFetch(`/groups/${id}/members/${memberId}`, {
        method: "PATCH", body: JSON.stringify({ nickname: editName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMemberError(data.error || "Couldn't rename"); return; }
      setEditingMemberId(null);
      await loadData();
    } catch { setMemberError("Network error. Please try again."); }
    finally { setMemberBusy(false); }
  }

  async function leaveGroup() {
    if (!confirm("Leave this group? Your past expenses stay in the group's history.")) return;
    setMemberBusy(true); setMemberError(null);
    try {
      const res = await authFetch(`/groups/${id}/leave`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMemberError(data.error || "Couldn't leave the group"); return; }
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      queryClient.invalidateQueries({ queryKey: ["balance"] });
      router.replace("/groups");
    } catch { setMemberError("Network error. Please try again."); }
    finally { setMemberBusy(false); }
  }

  async function removePerson(memberId: string, name: string) {
    if (!confirm(`Remove ${name} from the group?`)) return;
    setMemberBusy(true); setMemberError(null);
    try {
      const res = await authFetch(`/groups/${id}/members/${memberId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMemberError(data.error || "Couldn't remove"); return; }
      await loadData();
    } catch { setMemberError("Network error. Please try again."); }
    finally { setMemberBusy(false); }
  }

  const feedItems = useMemo(() => {
    const only = aiFilter ? new Set(aiFilter) : null;
    const exp = expenses
      .filter((e) => !only || only.has(e.id))
      .map((e) => ({ type: 'expense' as const, data: e, createdAt: new Date(e.createdAt).getTime() }));
    // Settlements are hidden while showing bills from an answer.
    const set = only ? [] : settlements.map((s) => ({ type: 'settlement' as const, data: s, createdAt: new Date(s.createdAt).getTime() }));
    return [...exp, ...set].sort((a, b) => b.createdAt - a.createdAt);
  }, [expenses, settlements, aiFilter]);

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
  const isAdmin = group.myRole === "admin";
  const notJoinedCount = group.members.filter((m) => m.isPlaceholder).length;

  return (
    <>
      <main className="min-h-screen page-content pb-24 bg-[var(--ink)]">
        
        {/* ── Sticky Premium Context Header ────────────────────────────────────────── */}
        <div className="sticky top-0 z-20 bg-[var(--ink)]/80 backdrop-blur-xl px-5 pt-14 pb-4 border-b border-[var(--hairline)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => router.back()} className="h-10 w-10 flex items-center justify-center bg-white rounded-full shadow-sm border border-[var(--hairline)] active:scale-95 transition-transform">
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
          </div>
        </div>

        {/* ── Action Pills ────────────────────────────────────────── */}
        <div className="px-5 py-4 flex gap-2 overflow-x-auto hide-scrollbar sticky top-[88px] z-10 bg-[var(--ink)]/90 backdrop-blur-sm">
          <Link href={`/groups/${id}/balance`} className="bg-white border border-[var(--hairline)] shadow-sm flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-[14px] font-semibold rounded-full active:scale-95 transition-transform">
            <Scale className="h-4 w-4 text-[var(--accent)]" strokeWidth={2} />
            Balance
          </Link>
          <Link href={`/groups/${id}/settle`} className="bg-white border border-[var(--hairline)] shadow-sm flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-[14px] font-semibold rounded-full active:scale-95 transition-transform">
            <ArrowRightLeft className="h-4 w-4 text-[var(--accent)]" strokeWidth={2} />
            Settle Up
          </Link>
          <Link href={`/groups/${id}/activity`} className="bg-white border border-[var(--hairline)] shadow-sm flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-[14px] font-semibold rounded-full active:scale-95 transition-transform">
            <History className="h-4 w-4 text-[var(--accent)]" strokeWidth={2} />
            Activity
          </Link>
          <button onClick={shareGroupSummary} className="bg-white border border-[var(--hairline)] shadow-sm flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-[14px] font-semibold rounded-full active:scale-95 transition-transform">
            <Share2 className="h-4 w-4 text-[var(--accent)]" strokeWidth={2} />
            Share
          </button>
          <button onClick={() => setShowInvite(!showInvite)} className="bg-white border border-[var(--hairline)] shadow-sm flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-[14px] font-semibold rounded-full active:scale-95 transition-transform">
            <LinkIcon className="h-4 w-4 text-[var(--accent)]" strokeWidth={2} />
            Invite
          </button>
        </div>

        <AnimatePresence>
          {showInvite && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-5 mb-5 overflow-hidden">
              <div className="bg-white p-5 rounded-[24px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-[var(--hairline)]">
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
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="w-full flex items-center gap-2.5 bg-white rounded-[14px] pl-3.5 pr-3 py-3.5 text-left border border-[var(--hairline)] shadow-[0_2px_8px_rgba(0,0,0,0.02)] active:scale-[0.99] transition-transform"
          >
            <Sparkles size={18} strokeWidth={2} className="text-[var(--accent)] flex-shrink-0" />
            <span className="flex-1 text-[15px] font-medium text-[var(--text-muted)] truncate">Ask Spenit… e.g. What&apos;s pending?</span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)] px-2 py-1 rounded-[8px] bg-[var(--accent-subtle)]">Chat</span>
          </button>

          {aiFilter && (
            <div className="mt-3 flex items-center gap-2 px-3.5 py-2.5 rounded-[14px] bg-[var(--accent-subtle)]">
              <Sparkles size={15} className="text-[var(--accent)] flex-shrink-0" />
              <p className="flex-1 text-[13px] font-semibold text-[var(--text-primary)]">Showing {aiFilter.length} {aiFilter.length === 1 ? "bill" : "bills"} from your chat</p>
              <button onClick={() => setChatOpen(true)} className="text-[12px] font-bold text-[var(--accent)] px-2">Chat</button>
              <button onClick={() => setAiFilter(null)} className="p-1 text-[var(--accent)]" aria-label="Show all"><X size={16} /></button>
            </div>
          )}
        </div>

        {/* ── Expenses ────────────────────────────────────────── */}
        <div className="px-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>EXPENSES</SectionLabel>
            <div className="flex items-center gap-2">
              <Link href={`/groups/${id}/expenses/new`} className="text-[13px] font-bold text-[var(--text-secondary)] px-3 py-1.5 active:scale-95 transition-transform">
                Manual
              </Link>
              <Link href={`/groups/${id}/import`} className="text-[13px] font-bold text-[var(--text-secondary)] px-3 py-1.5 active:scale-95 transition-transform">
                Import orders
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
            <div className="bg-white rounded-[24px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-[var(--hairline)] overflow-hidden divide-y divide-[var(--hairline)]">
              {feedItems.map((item) => (
                item.type === 'expense' ? (
                  (item.data as Expense).pending ? (
                    <PendingRow
                      key={`exp-${item.data.id}`}
                      expense={item.data as Expense}
                      outbox={pendingItems.find((p) => `pending-${p.id}` === item.data.id)}
                      onRetry={retryOutbox}
                      onDiscard={discardOutbox}
                    />
                  ) : (
                    <ExpenseRow
                      key={`exp-${item.data.id}`}
                      expense={item.data as Expense}
                      onClick={() => setSelectedExpense(item.data as Expense)}
                    />
                  )
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
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>MEMBERS ({group.members.length})</SectionLabel>
            {isAdmin && (
              <button
                onClick={() => { setShowAddPerson((v) => !v); setMemberError(null); }}
                className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--accent)] px-3 py-1.5 active:scale-95 transition-transform"
              >
                <UserPlus size={15} strokeWidth={2.5} />
                Add someone
              </button>
            )}
          </div>

          {isAdmin && notJoinedCount > 0 && !showAddPerson && (
            <p className="text-[13px] text-[var(--text-secondary)] mb-3">
              {`${notJoinedCount} ${notJoinedCount === 1 ? "person hasn't" : "people haven't"} joined yet. You can still add their expenses. When they open the invite link they'll pick their name and see what they owe.`}
            </p>
          )}

          <AnimatePresence>
            {showAddPerson && (
              <motion.form
                onSubmit={addPerson}
                initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden mb-3"
              >
                <div className="bg-white p-4 rounded-[20px] border border-[var(--hairline)] shadow-sm">
                  <label htmlFor="new-person" className="block text-[13px] font-bold text-[var(--text-primary)] mb-1.5">
                    Name of the person
                  </label>
                  <p className="text-[12px] text-[var(--text-secondary)] mb-2.5">
                    They don&apos;t need the app yet. Add expenses for them now and invite them later.
                  </p>
                  <div className="flex gap-2">
                    <input
                      id="new-person"
                      autoFocus
                      value={newPersonName}
                      onChange={(e) => { setNewPersonName(e.target.value); setMemberError(null); }}
                      maxLength={30}
                      placeholder="e.g. Rahul"
                      className="flex-1 min-w-0 bg-[var(--paper-dim)] rounded-[12px] px-3.5 py-3 text-[15px] font-medium focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)]"
                    />
                    <button
                      type="submit"
                      disabled={memberBusy || !newPersonName.trim()}
                      className="bg-[var(--accent)] text-white px-4 rounded-[12px] font-bold text-[14px] disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </motion.form>
            )}
          </AnimatePresence>

          {memberError && (
            <p role="alert" className="text-[13px] font-medium text-[var(--negative)] mb-3">{memberError}</p>
          )}

          {(() => {
            const meM = group.members.find((x) => x.id === user?.id);
            const c = meM?.claim;
            if (!meM || !c || Date.now() - new Date(c.claimedAt).getTime() > 7 * 86_400_000) return null;
            return (
              <div className="mb-3 p-3.5 rounded-[16px] bg-[var(--accent-subtle)] text-[13px] flex items-center gap-3">
                <UserPlus size={18} className="text-[var(--accent)] flex-shrink-0" />
                <p className="flex-1">You joined as <b>{c.placeholderName ?? meM.name}</b>. Picked the wrong name?</p>
                <button onClick={() => setClaimFix({ member: meM, asAdmin: false })} className="px-3 py-1.5 rounded-full bg-[var(--paper)] font-bold text-[var(--accent)] flex-shrink-0">Not me</button>
              </div>
            );
          })()}

          {(() => {
            // Two people with no picture and the same initials can't be told apart at a glance.
            const sets = lookAlikes(group.members);
            if (sets.length === 0) return null;
            const meInIt = sets.some((s) => s.some((p) => p.id === user?.id));
            const meMember = group.members.find((x) => x.id === user?.id);
            return (
              <div className="mb-3 p-3.5 rounded-[16px] bg-[var(--accent-subtle)] text-[13px] flex items-start gap-3">
                <div className="flex -space-x-2 flex-shrink-0 pt-0.5">
                  {sets[0].slice(0, 3).map((p) => <MemberAvatar key={p.id} person={p} size={26} className="ring-2 ring-[var(--paper)]" />)}
                </div>
                <div className="flex-1">
                  <b>{sets.map((s) => s.map((p) => p.name).join(" & ")).join(", ")}</b> look alike ({sets.map((s) => initials(s[0].name)).join(", ")}).
                  {" "}Give each a picture so everyone knows who is who.
                  {meInIt && meMember && (
                    <button onClick={() => setAvatarFor(meMember)} className="block mt-1.5 font-bold text-[var(--accent)]">Pick my avatar</button>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="bg-white rounded-[24px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-[var(--hairline)] overflow-hidden divide-y divide-[var(--hairline)]">
            {group.members.map((m) => {
              const canRename = m.id === user?.id || (isAdmin && m.isPlaceholder);
              // You pick your own avatar; anyone may pick one for someone who hasn't joined.
              const canPickAvatar = m.id === user?.id || m.isPlaceholder;
              const bal = memberBalances[m.id];
              const hasBalance = !!bal && parseFloat(bal.netAmount) > 0;
              return (
              <div key={m.id} className="p-4 flex items-center gap-3">
                {canPickAvatar ? (
                  <button
                    onClick={() => setAvatarFor(m)}
                    aria-label={m.id === user?.id ? "Change your avatar in this group" : `Pick an avatar for ${m.name}`}
                    className="relative flex-shrink-0 active:scale-95 transition-transform"
                  >
                    <MemberAvatar person={m} size={40} />
                    <span className="absolute -bottom-1 -right-1 w-[18px] h-[18px] rounded-full bg-[var(--paper)] border border-[var(--hairline)] flex items-center justify-center text-[var(--text-secondary)] shadow-sm">
                      <Pencil size={9} strokeWidth={2.5} />
                    </span>
                  </button>
                ) : (
                  <MemberAvatar person={m} size={40} />
                )}
                <div className="flex-1 min-w-0">
                  {editingMemberId === m.id ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); saveNickname(m.id); }}
                      className="flex items-center gap-2"
                    >
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => { setEditName(e.target.value); setMemberError(null); }}
                        maxLength={30}
                        aria-label="Nickname"
                        className="flex-1 min-w-0 bg-[var(--paper-dim)] rounded-[10px] px-3 py-2 text-[14px] font-medium focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)]"
                      />
                      <button type="submit" disabled={memberBusy} className="text-[13px] font-bold text-[var(--accent)]">Save</button>
                      <button type="button" onClick={() => setEditingMemberId(null)} className="text-[13px] font-semibold text-[var(--text-secondary)]">Cancel</button>
                    </form>
                  ) : (
                    <>
                      <p className="text-[15px] font-bold tracking-tight text-[var(--text-primary)] truncate flex items-center gap-1.5">
                        <span className="truncate">{m.name}{m.id === user?.id ? " (you)" : ""}</span>
                        {canRename && (
                          <button
                            onClick={() => { setEditingMemberId(m.id); setEditName(m.nickname || (m.isPlaceholder ? m.name : "")); setMemberError(null); }}
                            aria-label={`Edit name for ${m.name}`}
                            className="text-[var(--text-muted)] hover:text-[var(--accent)] flex-shrink-0"
                          >
                            <Pencil size={13} strokeWidth={2} />
                          </button>
                        )}
                      </p>
                      <p className="text-[13px] font-medium text-[var(--text-secondary)] truncate">
                        {m.isPlaceholder
                          ? "Not joined yet"
                          : m.nickname && m.realName && m.nickname !== m.realName
                            ? m.realName
                            : `@${m.username}`}
                      </p>
                      {isAdmin && m.claim && m.id !== user?.id && (
                        <button
                          onClick={() => setClaimFix({ member: m, asAdmin: true })}
                          className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-bold text-[var(--accent)]"
                        >
                          <Undo2 size={12} strokeWidth={2.5} /> Joined as {m.claim.placeholderName ?? m.name} · Fix
                        </button>
                      )}
                    </>
                  )}
                </div>
                {editingMemberId !== m.id && (
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {bal && (
                      <BalanceAmount amount={bal.netAmount} direction={bal.direction} variant="compact" />
                    )}
                    <div className="flex items-center gap-1.5">
                      {m.isPlaceholder && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-[6px] bg-[var(--accent-subtle)] text-[var(--accent)] uppercase tracking-wider">
                          Invite pending
                        </span>
                      )}
                      {m.role === "admin" && (
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-[6px] bg-[var(--paper-dim)] text-[var(--text-secondary)] uppercase tracking-wider">
                          <ShieldCheck size={11} strokeWidth={2.5} />
                          Admin
                        </span>
                      )}
                      {isAdmin && m.id !== user?.id && (m.isPlaceholder || bal?.direction === "owes") && (
                        <button
                          onClick={() => shareOweLink(m)}
                          aria-label={m.isPlaceholder ? `Invite ${m.name} on WhatsApp` : `Send ${m.name} their summary on WhatsApp`}
                          className="text-[var(--positive)]"
                        >
                          <MessageCircle size={15} strokeWidth={2.2} />
                        </button>
                      )}
                      {isAdmin && m.id !== user?.id && !hasBalance && (
                        <button
                          onClick={() => removePerson(m.id, m.name)}
                          aria-label={`Remove ${m.name}`}
                          className="text-[var(--text-muted)] hover:text-[var(--negative)]"
                        >
                          <Trash2 size={13} strokeWidth={2} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>

          {user && (
            <button
              onClick={leaveGroup}
              disabled={memberBusy}
              className="mt-4 mx-auto flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--negative)] px-3 py-2"
            >
              <LogOut size={14} /> Leave group
            </button>
          )}
        </div>
      </main>

      {claimFix && (
        <ClaimFixSheet
          groupId={id}
          member={claimFix.member}
          members={group.members}
          asAdmin={claimFix.asAdmin}
          onClose={() => setClaimFix(null)}
          onDone={async () => {
            setClaimFix(null);
            await loadData();
            queryClient.invalidateQueries({ queryKey: ["balance"] });
          }}
        />
      )}

      {chatOpen && (
        <GroupChat
          groupId={id}
          groupName={group.name}
          onClose={() => setChatOpen(false)}
          onShowExpenses={(ids) => { setAiFilter(ids); setChatOpen(false); }}
        />
      )}

      {avatarFor && user && (
        <AvatarPicker
          groupId={id}
          target={group.members.find((x) => x.id === avatarFor.id) ?? avatarFor}
          members={group.members}
          me={user.id}
          onClose={() => setAvatarFor(null)}
        />
      )}

      {selectedExpense && (
        <AvatarPeople people={group.members}>
        <ExpenseDetailModal
          expense={expenses.find((x) => x.id === selectedExpense.id) ?? selectedExpense}
          groupId={id}
          currentUserId={user?.id}
          isAdmin={isAdmin}
          onEdit={(e) =>
            router.push(
              e.splitType === "itemized"
                ? `/groups/${id}/import?edit=${encodeURIComponent(e.id)}` // same item editor as import
                : `/groups/${id}/expenses/new?edit=${encodeURIComponent(e.id)}`
            )
          }
          onRepeat={(e) => {
            router.push(`/groups/${id}/expenses/new?repeat=${encodeURIComponent(e.id)}`);
          }}
          onClose={() => setSelectedExpense(null)}
          onDelete={async (id) => {
            await deleteExpense(id);
            setSelectedExpense(null);
          }}
          isDeleting={deletingId === selectedExpense.id}
        />
        </AvatarPeople>
      )}

      <BottomNav />
    </>
  );
}