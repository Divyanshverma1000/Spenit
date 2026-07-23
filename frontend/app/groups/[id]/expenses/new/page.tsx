"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type SplitMode = "equal" | "fairshare" | "exact";

interface Member {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

interface PersonalItem {
  id: string;
  label: string;
  amount: string;
}

interface FairshareParticipant {
  userId: string;
  items: PersonalItem[];
}

const SPLIT_MODES: { key: SplitMode; label: string; emoji: string; desc: string }[] = [
  {
    key: "equal",
    label: "Equal split",
    emoji: "⚡",
    desc: "Everyone pays the same amount",
  },
  {
    key: "fairshare",
    label: "Fairshare ✨",
    emoji: "🎯",
    desc: "Add personal items — shared costs split equally on top",
  },
  {
    key: "exact",
    label: "Custom amounts",
    emoji: "🔢",
    desc: "Specify each person's exact share",
  },
];

function newItem(): PersonalItem {
  return { id: crypto.randomUUID(), label: "", amount: "" };
}

/** Sum an array of PersonalItems, treating blank amounts as 0 */
function sumItems(items: PersonalItem[]): number {
  return items.reduce((a, it) => a + (parseFloat(it.amount) || 0), 0);
}

/** Format a number as ₹X,XXX.XX */
function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function NewExpensePage() {
  const { id: groupId } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const { accessToken, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  // ── Common fields ──────────────────────────────────────────────────────────
  const [description, setDescription] = useState("");
  // Pre-fill amount from ?amount= param (AI fallback redirect)
  const [totalAmount, setTotalAmount] = useState(searchParams?.get("amount") || "");
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");

  // ── Payer ─────────────────────────────────────────────────────────────────
  // v0: single payer (current user). Multi-payer is advanced; we auto-fill.
  const [payerId, setPayerId] = useState<string>("");

  // ── Equal / Fairshare participants ─────────────────────────────────────────
  const [participants, setParticipants] = useState<Set<string>>(new Set());

  // ── Fairshare personal items per participant ───────────────────────────────
  const [fairshare, setFairshare] = useState<Record<string, PersonalItem[]>>({});

  // ── Exact amounts per participant ──────────────────────────────────────────
  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>({});

  // ── Form state ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load members
  useEffect(() => {
    if (!accessToken || !groupId) return;
    fetch(`${API_URL}/groups/${groupId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        const mems: Member[] = data.members || [];
        setMembers(mems);
        if (user) setPayerId(user.id);
        const all = new Set(mems.map((m) => m.id));
        setParticipants(all);
        // Init fairshare: each member gets one empty item slot
        const fs: Record<string, PersonalItem[]> = {};
        mems.forEach((m) => { fs[m.id] = [newItem()]; });
        setFairshare(fs);
        // Init exact: each member gets empty string
        const ex: Record<string, string> = {};
        mems.forEach((m) => { ex[m.id] = ""; });
        setExactAmounts(ex);
      })
      .catch(console.error)
      .finally(() => setMembersLoading(false));
  }, [accessToken, groupId, user]);

  const getMemberName = useCallback(
    (uid: string) => members.find((m) => m.id === uid)?.name || uid,
    [members]
  );

  // ── Computed preview values ────────────────────────────────────────────────
  const amountNum = parseFloat(totalAmount) || 0;

  // Fairshare: compute each person's total personal spend and shared pool
  const fairsharePersonalTotals = Object.fromEntries(
    Array.from(participants).map((uid) => [uid, sumItems(fairshare[uid] || [])])
  );
  const totalPersonal = Object.values(fairsharePersonalTotals).reduce((a, b) => a + b, 0);
  const sharedPool = Math.max(0, amountNum - totalPersonal);
  const participantCount = participants.size;
  const sharedPerPerson = participantCount > 0 ? sharedPool / participantCount : 0;
  const fairsharePreview = Object.fromEntries(
    Array.from(participants).map((uid) => [
      uid,
      (fairsharePersonalTotals[uid] || 0) + sharedPerPerson,
    ])
  );

  // Exact: sum of entered amounts
  const exactTotal = Array.from(participants).reduce(
    (a, uid) => a + (parseFloat(exactAmounts[uid] || "0") || 0),
    0
  );

  // ── Fairshare item helpers ─────────────────────────────────────────────────
  function addFairshareItem(uid: string) {
    setFairshare((prev) => ({ ...prev, [uid]: [...(prev[uid] || []), newItem()] }));
  }
  function removeFairshareItem(uid: string, itemId: string) {
    setFairshare((prev) => ({
      ...prev,
      [uid]: (prev[uid] || []).filter((it) => it.id !== itemId),
    }));
  }
  function updateFairshareItem(uid: string, itemId: string, field: "label" | "amount", val: string) {
    setFairshare((prev) => ({
      ...prev,
      [uid]: (prev[uid] || []).map((it) => (it.id === itemId ? { ...it, [field]: val } : it)),
    }));
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!description.trim()) { setError("Description is required"); return; }
    if (!amountNum || amountNum <= 0) { setError("Enter a valid total amount"); return; }
    if (!payerId) { setError("Select who paid"); return; }
    if (participants.size === 0) { setError("At least one participant required"); return; }

    if (splitMode === "fairshare" && totalPersonal > amountNum) {
      setError(`Personal items total (${fmt(totalPersonal)}) exceeds bill total (${fmt(amountNum)})`);
      return;
    }
    if (splitMode === "exact") {
      const diff = Math.abs(exactTotal - amountNum);
      if (diff > 0.01) {
        setError(`Shares sum to ${fmt(exactTotal)} but total is ${fmt(amountNum)}. Difference: ${fmt(diff)}`);
        return;
      }
    }

    const participantArray = Array.from(participants);
    let participantsPayload;

    if (splitMode === "equal") {
      participantsPayload = participantArray.map((uid) => ({ userId: uid }));
    } else if (splitMode === "fairshare") {
      participantsPayload = participantArray.map((uid) => ({
        userId: uid,
        personalAmount: parseFloat(fairsharePersonalTotals[uid].toFixed(2)),
      }));
    } else {
      participantsPayload = participantArray.map((uid) => ({
        userId: uid,
        shareAmount: parseFloat(exactAmounts[uid] || "0"),
      }));
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/expenses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          groupId,
          description: description.trim(),
          amount: amountNum,
          currency: "INR",
          splitType: splitMode,
          payers: [{ userId: payerId }], // Single payer — backend auto-fills amountPaid = total
          participants: participantsPayload,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to add expense");
        return;
      }
      router.push(`/groups/${groupId}`);
    } catch {
      setError("Network error — is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  if (!authed) return null;

  return (
    <>
      <main className="min-h-screen bg-[#0a0a12] page-content">
        {/* Header */}
        <div className="px-5 pt-14 pb-4 flex items-center gap-3">
          <button onClick={() => router.back()} className="text-slate-500 hover:text-slate-300 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">Add Expense</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {splitMode === "fairshare" ? "✨ Fairshare mode" : splitMode === "exact" ? "Custom amounts" : "Equal split"}
            </p>
          </div>
        </div>

        {membersLoading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-5 space-y-5 pb-6">
            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                What was it for?
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Dinner at Thali House"
                autoFocus
                className="w-full rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 px-4 py-3 text-base focus:outline-none focus:border-violet-500/50 transition-colors"
              />
            </div>

            {/* Total amount */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Total bill amount
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-lg font-semibold">₹</span>
                <input
                  type="number"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0.01"
                  className="w-full rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 pl-9 pr-4 py-3 text-xl font-bold focus:outline-none focus:border-violet-500/50 transition-colors"
                />
              </div>
            </div>

            {/* Paid by */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Paid by
              </label>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPayerId(m.id)}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      payerId === m.id
                        ? "bg-violet-600 text-white"
                        : "bg-white/5 border border-white/10 text-slate-400"
                    }`}
                  >
                    <span className="h-5 w-5 rounded-full bg-violet-500/30 flex items-center justify-center text-xs text-violet-300 font-bold">
                      {m.name.charAt(0).toUpperCase()}
                    </span>
                    {m.id === user?.id ? "You" : m.name}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Split mode selector ─────────────────────────────────────── */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                How to split
              </label>
              <div className="space-y-2">
                {SPLIT_MODES.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    onClick={() => setSplitMode(mode.key)}
                    className={`w-full flex items-center gap-3 rounded-xl p-3.5 transition-colors text-left ${
                      splitMode === mode.key
                        ? "bg-violet-600/20 border border-violet-500/40"
                        : "bg-white/4 border border-white/8 hover:bg-white/8"
                    }`}
                  >
                    <span className="text-2xl">{mode.emoji}</span>
                    <div>
                      <p className={`text-sm font-semibold ${splitMode === mode.key ? "text-violet-300" : "text-white"}`}>
                        {mode.label}
                      </p>
                      <p className="text-xs text-slate-500">{mode.desc}</p>
                    </div>
                    {splitMode === mode.key && (
                      <span className="ml-auto text-violet-400">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Who's splitting ─────────────────────────────────────────── */}
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Who's splitting
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {members.map((m) => {
                  const on = participants.has(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setParticipants((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(m.id); else next.add(m.id);
                          return next;
                        });
                      }}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                        on ? "bg-emerald-600/20 border border-emerald-500/40 text-emerald-300" : "bg-white/5 border border-white/10 text-slate-500"
                      }`}
                    >
                      {on ? "✓ " : ""}{m.id === user?.id ? "You" : m.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── FAIRSHARE MODE ─────────────────────────────────────────────── */}
            {splitMode === "fairshare" && participants.size > 0 && (
              <div className="space-y-3">
                {/* Pool summary */}
                {amountNum > 0 && (
                  <div className="glass-card p-4 border-violet-500/20 bg-violet-500/5">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Total bill</span>
                      <span className="text-white font-semibold">{fmt(amountNum)}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Personal items</span>
                      <span className={totalPersonal > amountNum ? "text-rose-400 font-semibold" : "text-white"}>
                        − {fmt(totalPersonal)}
                      </span>
                    </div>
                    <div className="border-t border-white/10 pt-2 flex justify-between text-sm">
                      <span className="text-slate-400">
                        Shared pool ÷ {participantCount} =
                      </span>
                      <span className="text-violet-300 font-bold">
                        {fmt(sharedPerPerson)} each
                      </span>
                    </div>
                  </div>
                )}

                {/* Per-person personal items */}
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Personal items (optional)</p>
                {Array.from(participants).map((uid) => {
                  const memberName = getMemberName(uid);
                  const items = fairshare[uid] || [];
                  const myTotal = sumItems(items);
                  const myShare = fairsharePreview[uid] || 0;
                  return (
                    <div key={uid} className="glass-card p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-violet-500/40 to-fuchsia-500/40 flex items-center justify-center text-xs font-bold text-white">
                            {memberName.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm font-semibold text-white">
                            {uid === user?.id ? "You" : memberName}
                          </span>
                        </div>
                        {amountNum > 0 && (
                          <span className="text-xs font-bold text-emerald-400">
                            Total: {fmt(myShare)}
                          </span>
                        )}
                      </div>

                      {/* Item rows */}
                      {items.map((item) => (
                        <div key={item.id} className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="Item name (optional)"
                            value={item.label}
                            onChange={(e) => updateFairshareItem(uid, item.id, "label", e.target.value)}
                            className="flex-1 rounded-lg bg-black/30 border border-white/8 text-white placeholder-slate-700 px-3 py-1.5 text-xs focus:outline-none focus:border-violet-500/40"
                          />
                          <div className="relative w-28">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">₹</span>
                            <input
                              type="number"
                              placeholder="0"
                              value={item.amount}
                              onChange={(e) => updateFairshareItem(uid, item.id, "amount", e.target.value)}
                              step="0.01"
                              min="0"
                              className="w-full rounded-lg bg-black/30 border border-white/8 text-white placeholder-slate-700 pl-6 pr-2 py-1.5 text-xs focus:outline-none focus:border-violet-500/40"
                            />
                          </div>
                          {items.length > 1 && (
                            <button type="button" onClick={() => removeFairshareItem(uid, item.id)}
                              className="text-slate-700 hover:text-rose-400 transition-colors text-lg leading-none w-5 flex-shrink-0">
                              ×
                            </button>
                          )}
                        </div>
                      ))}

                      {/* Add item / subtotal row */}
                      <div className="flex items-center justify-between pt-1">
                        <button type="button" onClick={() => addFairshareItem(uid)}
                          className="text-xs text-violet-400 hover:text-violet-300 transition-colors flex items-center gap-1">
                          <span className="text-base leading-none">+</span> Add item
                        </button>
                        {myTotal > 0 && (
                          <span className="text-xs text-slate-500">
                            Personal: {fmt(myTotal)} · Shared: {fmt(sharedPerPerson)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── EXACT MODE ────────────────────────────────────────────────── */}
            {splitMode === "exact" && participants.size > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Each person's share</p>
                  {amountNum > 0 && (
                    <span className={`text-xs font-semibold ${Math.abs(exactTotal - amountNum) < 0.01 ? "text-emerald-400" : "text-rose-400"}`}>
                      {fmt(exactTotal)} / {fmt(amountNum)}
                    </span>
                  )}
                </div>
                {Array.from(participants).map((uid) => (
                  <div key={uid} className="flex items-center gap-3 glass-card p-3">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-violet-500/40 to-fuchsia-500/40 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                      {getMemberName(uid).charAt(0).toUpperCase()}
                    </div>
                    <span className="flex-1 text-sm text-white truncate">
                      {uid === user?.id ? "You" : getMemberName(uid)}
                    </span>
                    <div className="relative w-32">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">₹</span>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={exactAmounts[uid] || ""}
                        onChange={(e) => setExactAmounts((prev) => ({ ...prev, [uid]: e.target.value }))}
                        step="0.01"
                        min="0"
                        className="w-full rounded-lg bg-black/30 border border-white/10 text-white pl-7 pr-2 py-2 text-sm focus:outline-none focus:border-violet-500/40"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── EQUAL MODE preview ─────────────────────────────────────────── */}
            {splitMode === "equal" && amountNum > 0 && participants.size > 0 && (
              <div className="glass-card p-4 flex justify-between items-center">
                <span className="text-sm text-slate-400">Each person pays</span>
                <span className="text-sm font-bold text-white">
                  {fmt(amountNum / participants.size)}
                </span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3">
                <p className="text-sm text-rose-400">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !description.trim() || !amountNum}
              className="w-full btn-primary py-4 text-base font-semibold disabled:opacity-40"
            >
              {loading ? "Saving…" : "Add Expense →"}
            </button>

            <p className="text-center text-xs text-slate-700">
              💡 Tip: Fairshare mode lets you log personal items + splits the rest equally
            </p>
          </form>
        )}
      </main>
      <BottomNav />
    </>
  );
}
