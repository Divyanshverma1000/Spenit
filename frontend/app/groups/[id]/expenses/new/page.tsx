"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Equal, Hash, Target } from "lucide-react";

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

const SPLIT_MODES: { key: SplitMode; label: string; icon: any; desc: string }[] = [
  {
    key: "equal",
    label: "Equal split",
    icon: Equal,
    desc: "Everyone pays the same amount",
  },
  {
    key: "fairshare",
    label: "Fairshare",
    icon: Target,
    desc: "Add personal items — shared costs split equally",
  },
  {
    key: "exact",
    label: "Custom amounts",
    icon: Hash,
    desc: "Specify exact shares",
  },
];

function newItem(): PersonalItem {
  return { id: crypto.randomUUID(), label: "", amount: "" };
}

function sumItems(items: PersonalItem[]): number {
  return items.reduce((a, it) => a + (parseFloat(it.amount) || 0), 0);
}

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

  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState(searchParams?.get("amount") || "");
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");

  const [payerId, setPayerId] = useState<string>("");
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [fairshare, setFairshare] = useState<Record<string, PersonalItem[]>>({});
  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>({});
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const fs: Record<string, PersonalItem[]> = {};
        mems.forEach((m) => { fs[m.id] = [newItem()]; });
        setFairshare(fs);
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

  const amountNum = parseFloat(totalAmount) || 0;
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

  const exactTotal = Array.from(participants).reduce(
    (a, uid) => a + (parseFloat(exactAmounts[uid] || "0") || 0),
    0
  );

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
          payers: [{ userId: payerId }],
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
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  if (!authed) return null;

  return (
    <>
      <main className="min-h-screen page-content pb-24" style={{ backgroundColor: "var(--ink)" }}>
        <PageHeader 
          title="Add Expense" 
          onBack={() => router.back()} 
        />

        {membersLoading ? (
          <div className="flex justify-center py-20">
            <div className="spinner" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-4 space-y-4">
            <Card padding="md">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>
                    Description
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Dinner"
                    autoFocus
                    className="input-field w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>
                    Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold" style={{ color: "var(--text-muted)" }}>₹</span>
                    <input
                      type="number"
                      value={totalAmount}
                      onChange={(e) => setTotalAmount(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0.01"
                      className="input-field w-full pl-8 font-bold text-lg tabular-nums"
                      style={{ fontFamily: "var(--font-display)" }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>
                    Paid by
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setPayerId(m.id)}
                        className="flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors border"
                        style={{
                          backgroundColor: payerId === m.id ? "var(--paper-dim)" : "transparent",
                          borderColor: payerId === m.id ? "var(--border-dark)" : "var(--border)",
                          color: "var(--text-primary)"
                        }}
                      >
                        <span className="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: "var(--accent)", color: "var(--paper)" }}>
                          {m.name.charAt(0).toUpperCase()}
                        </span>
                        {m.id === user?.id ? "You" : m.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card padding="md">
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>
                Split mode
              </label>
              <div className="space-y-2 mb-4">
                {SPLIT_MODES.map((mode) => {
                  const Icon = mode.icon;
                  return (
                    <button
                      key={mode.key}
                      type="button"
                      onClick={() => setSplitMode(mode.key)}
                      className="w-full flex items-center gap-3 rounded-[var(--radius-sm)] p-3 transition-colors text-left border"
                      style={{
                        backgroundColor: splitMode === mode.key ? "var(--paper-dim)" : "transparent",
                        borderColor: splitMode === mode.key ? "var(--border-dark)" : "var(--border)"
                      }}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.5} style={{ color: splitMode === mode.key ? "var(--accent)" : "var(--text-secondary)" }} />
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{mode.label}</p>
                        <p className="text-[10px]" style={{ color: "var(--text-secondary)" }}>{mode.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>
                Participants
              </label>
              <div className="flex flex-wrap gap-2">
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
                      className="flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium transition-colors border"
                      style={{
                        backgroundColor: on ? "var(--paper-dim)" : "transparent",
                        borderColor: on ? "var(--border-dark)" : "var(--border)",
                        color: on ? "var(--text-primary)" : "var(--text-muted)"
                      }}
                    >
                      {m.id === user?.id ? "You" : m.name}
                    </button>
                  );
                })}
              </div>
            </Card>

            {splitMode === "fairshare" && participants.size > 0 && (
              <div className="space-y-3">
                {amountNum > 0 && (
                  <Card padding="sm" style={{ backgroundColor: "var(--paper-dim)" }}>
                    <div className="flex justify-between text-sm mb-1 text-secondary">
                      <span>Total bill</span>
                      <span className="font-medium" style={{ color: "var(--text-primary)" }}>{fmt(amountNum)}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-1 text-secondary">
                      <span>Personal items</span>
                      <span className="font-medium" style={{ color: totalPersonal > amountNum ? "var(--negative)" : "var(--text-primary)" }}>− {fmt(totalPersonal)}</span>
                    </div>
                    <div className="border-t pt-2 mt-2 flex justify-between text-sm" style={{ borderColor: "var(--border)" }}>
                      <span style={{ color: "var(--text-secondary)" }}>Shared pool ÷ {participantCount} =</span>
                      <span className="font-semibold" style={{ color: "var(--accent)" }}>{fmt(sharedPerPerson)} each</span>
                    </div>
                  </Card>
                )}

                {Array.from(participants).map((uid) => {
                  const memberName = getMemberName(uid);
                  const items = fairshare[uid] || [];
                  const myTotal = sumItems(items);
                  const myShare = fairsharePreview[uid] || 0;
                  return (
                    <Card key={uid} padding="sm">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                          {uid === user?.id ? "You" : memberName}
                        </span>
                        {amountNum > 0 && (
                          <span className="text-xs font-bold" style={{ color: "var(--positive)" }}>
                            Total: {fmt(myShare)}
                          </span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {items.map((item) => (
                          <div key={item.id} className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Item (optional)"
                              value={item.label}
                              onChange={(e) => updateFairshareItem(uid, item.id, "label", e.target.value)}
                              className="input-field flex-1 text-xs px-2 py-1.5"
                            />
                            <input
                              type="number"
                              placeholder="0"
                              value={item.amount}
                              onChange={(e) => updateFairshareItem(uid, item.id, "amount", e.target.value)}
                              step="0.01"
                              min="0"
                              className="input-field w-20 text-xs px-2 py-1.5 tabular-nums"
                            />
                            {items.length > 1 && (
                              <button type="button" onClick={() => removeFairshareItem(uid, item.id)} className="px-2" style={{ color: "var(--text-muted)" }}>×</button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button type="button" onClick={() => addFairshareItem(uid)} className="text-xs mt-2 font-medium" style={{ color: "var(--accent)" }}>
                        + Add item
                      </button>
                    </Card>
                  );
                })}
              </div>
            )}

            {splitMode === "exact" && participants.size > 0 && (
              <Card padding="md">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Exact shares</span>
                  {amountNum > 0 && (
                    <span className="text-xs font-semibold" style={{ color: Math.abs(exactTotal - amountNum) < 0.01 ? "var(--positive)" : "var(--negative)" }}>
                      {fmt(exactTotal)} / {fmt(amountNum)}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {Array.from(participants).map((uid) => (
                    <div key={uid} className="flex items-center gap-3">
                      <span className="flex-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {uid === user?.id ? "You" : getMemberName(uid)}
                      </span>
                      <div className="w-24">
                        <input
                          type="number"
                          placeholder="0.00"
                          value={exactAmounts[uid] || ""}
                          onChange={(e) => setExactAmounts((prev) => ({ ...prev, [uid]: e.target.value }))}
                          step="0.01"
                          min="0"
                          className="input-field w-full px-2 py-1.5 text-sm tabular-nums"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {splitMode === "equal" && amountNum > 0 && participants.size > 0 && (
              <Card padding="sm" style={{ backgroundColor: "var(--paper-dim)" }}>
                <div className="flex justify-between items-center text-sm">
                  <span style={{ color: "var(--text-secondary)" }}>Each person pays</span>
                  <span className="font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {fmt(amountNum / participants.size)}
                  </span>
                </div>
              </Card>
            )}

            {error && (
              <div className="p-3 text-sm rounded-[var(--radius-sm)]" style={{ backgroundColor: "var(--paper-dim)", color: "var(--negative)" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !description.trim() || !amountNum}
              className="btn-primary w-full py-3 mt-4"
            >
              {loading ? "Saving..." : "Add Expense"}
            </button>
          </form>
        )}
      </main>
      <BottomNav />
    </>
  );
}
