"use client";

import { API_URL } from "@/lib/api";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useOutbox } from "@/context/OutboxContext";
import { useGroupOverview, groupKey } from "@/lib/queries";
import { planRepeat, SpecificItem } from "@/lib/repeat";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Search, Repeat } from "lucide-react";
import ItemsOnTop from "@/components/ItemsOnTop";
import { splitWithItems } from "@/lib/itemSplit";
import MemberAvatar from "@/components/ui/MemberAvatar";


interface Member {
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
}

function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function UniversalExpensePage() {
  const { id: groupId } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const { user, authFetch } = useAuth();
  const { enqueue } = useOutbox();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Members come from the cached group overview: the form opens instantly, even offline.
  const { data: overview, isPending: overviewPending } = useGroupOverview(groupId);
  const members: Member[] = useMemo(() => overview?.group.members ?? [], [overview]);
  const membersLoading = overviewPending && !overview;
  const initialised = useRef(false);

  // ?edit=<expenseId> changes an existing expense in place; ?repeat=<id> copies one into a new expense.
  const editId = searchParams?.get("edit") || null;
  const isEdit = !!editId;

  const [description, setDescription] = useState(searchParams?.get("description") || "");
  const [totalAmount, setTotalAmount] = useState(searchParams?.get("amount") || "");
  
  // Payers
  const [isMultiPayer, setIsMultiPayer] = useState(false);
  const [payerId, setPayerId] = useState<string>("");
  const [multiPayers, setMultiPayers] = useState<Record<string, string>>({});

  // Shared Pool Participants (Who splits the remainder?)
  const [sharedPoolParticipants, setSharedPoolParticipants] = useState<Set<string>>(new Set());

  // Specific Items (The Receipt Data)
  const [items, setItems] = useState<SpecificItem[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter for the "Split among" list (shown for bigger groups)
  const [splitSearch, setSplitSearch] = useState("");
  // Set when the form was pre-filled from an earlier expense ("Repeat")
  const [repeatedFrom, setRepeatedFrom] = useState<string | null>(null);
  // Editing an imported order: its item list, kept as a record (the form can't edit items)
  const [keptBill, setKeptBill] = useState<Record<string, unknown> | null>(null);

  // Set the form defaults once, when the members first become available.
  // With ?repeat=<expenseId> the form is pre-filled as an exact copy of that expense:
  // same payers and amounts, same people involved, same shares.
  useEffect(() => {
    if (!overview || !user || initialised.current) return;
    initialised.current = true;
    const mems = overview.group.members;
    const memberIds = new Set(mems.map((m) => m.id));

    const sourceId = searchParams?.get("edit") || searchParams?.get("repeat");
    const source = sourceId ? overview.expenses.find((e) => e.id === sourceId) : undefined;

    const emptyMulti: Record<string, string> = {};
    mems.forEach((m) => (emptyMulti[m.id] = ""));

    if (source) {
      const plan = planRepeat(source, mems);
      setRepeatedFrom(source.description);
      const rd = source.receiptData;
      if (searchParams?.get("edit") && rd && typeof rd === "object" && !Array.isArray(rd) && Array.isArray((rd as { items?: unknown }).items)) {
        setKeptBill(rd as Record<string, unknown>);
      }
      setDescription(source.description);
      setTotalAmount(String(parseFloat(source.amount)));

      const stillHere = source.payers.filter((p) => memberIds.has(p.userId));
      if (stillHere.length > 1) {
        setIsMultiPayer(true);
        const multi = { ...emptyMulti };
        stillHere.forEach((p) => (multi[p.userId] = String(parseFloat(p.amountPaid))));
        setMultiPayers(multi);
        setPayerId(stillHere[0].userId);
      } else {
        setPayerId(stillHere[0]?.userId ?? user.id);
        setMultiPayers({ ...emptyMulti, [stillHere[0]?.userId ?? user.id]: String(parseFloat(source.amount)) });
      }
      setItems(plan.items);
      setSharedPoolParticipants(new Set(plan.pool));
      return;
    }

    setPayerId(user.id);
    setMultiPayers({ ...emptyMulti, [user.id]: searchParams?.get("amount") || "" });
    // By default, everyone is in the shared pool
    setSharedPoolParticipants(new Set(mems.map((m) => m.id)));
  }, [overview, user, searchParams]);

  const amountNum = parseFloat(totalAmount) || 0;

  // --- Math engine: items first (split between whoever had them), the rest equally, in paise ---
  const split = useMemo(() => splitWithItems(amountNum, items, Array.from(sharedPoolParticipants)), [amountNum, items, sharedPoolParticipants]);
  const exactShares = split.shares;
  const itemTotal = split.itemsTotal;
  const sharedPool = split.rest;
  const nameOf = (id: string) => (id === user?.id ? "You" : members.find((m) => m.id === id)?.name.split(" ")[0] ?? "Someone");

  const toggleSharedPool = (uid: string) => {
    setSharedPoolParticipants(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  // Members shown in the "Split among" list (search only matters for bigger groups)
  const visibleMembers = useMemo(() => {
    const q = splitSearch.trim().toLowerCase();
    return q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members;
  }, [members, splitSearch]);
  const allVisibleSelected =
    visibleMembers.length > 0 && visibleMembers.every((m) => sharedPoolParticipants.has(m.id));

  /** Select (or clear) everyone currently shown in the list. */
  const toggleAllVisible = () => {
    setSharedPoolParticipants((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleMembers.forEach((m) => next.delete(m.id));
      else visibleMembers.forEach((m) => next.add(m.id));
      return next;
    });
  };

  const selectOnlyMe = () => {
    if (user) setSharedPoolParticipants(new Set([user.id]));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!description.trim()) { setError("Description is required"); return; }
    if (!amountNum || amountNum <= 0) { setError("Enter a valid total amount"); return; }
    if (!payerId) { setError("Select who paid"); return; }
    if (split.over) {
      setError(`The items (${fmt(itemTotal)}) cost more than the whole bill (${fmt(amountNum)})`);
      return;
    }
    const nobody = items.find((it) => (parseFloat(it.amount) || 0) > 0 && it.sharedBy.length === 0);
    if (nobody) {
      setError(`Pick who had ${nobody.label.trim() || "each item"}`);
      return;
    }
    
    // We send EXACT shares to backend for perfect accuracy
    const participantsPayload = Object.entries(exactShares)
      .filter(([_, amt]) => amt > 0)
      .map(([userId, amt]) => ({ userId, shareAmount: parseFloat(amt.toFixed(2)) }));

    if (participantsPayload.length === 0) {
      setError("Nobody owes anything. Please include participants.");
      return;
    }

    let finalPayers = [];
    if (isMultiPayer) {
      let sum = 0;
      for (const [uid, amtStr] of Object.entries(multiPayers)) {
        const amt = parseFloat(amtStr);
        if (amt > 0) {
          sum += amt;
          finalPayers.push({ userId: uid, amountPaid: amt });
        }
      }
      if (Math.abs(sum - amountNum) > 0.01) {
        setError(`Total paid (${fmt(sum)}) must equal total amount (${fmt(amountNum)})`);
        return;
      }
      if (finalPayers.length === 0) { setError("Please specify who paid"); return; }
    } else {
      if (!payerId) { setError("Select who paid"); return; }
      finalPayers = [{ userId: payerId, amountPaid: amountNum }];
    }

    // Editing: update the existing expense (needs a connection, since it changes shared balances).
    if (isEdit && editId) {
      setLoading(true);
      try {
        const res = await authFetch(`/expenses/${editId}`, {
          method: "PUT",
          body: JSON.stringify({
            groupId,
            description: description.trim(),
            amount: amountNum,
            currency: "INR",
            splitType: "exact",
            payers: finalPayers,
            participants: participantsPayload,
            receiptData: keptBill ? { ...keptBill, editedByHand: true } : items.length > 0 ? items : null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Couldn't save your changes");
          setLoading(false);
          return;
        }
        await queryClient.refetchQueries({ queryKey: groupKey(groupId) }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["balance"] });
        router.push(`/groups/${groupId}`);
      } catch {
        setError("You're offline. Connect to the internet to save changes to an existing expense.");
        setLoading(false);
      }
      return;
    }

    // Save on this device first and sync in the background: instant on any network.
    setLoading(true);
    try {
      await enqueue({
        groupId,
        description: description.trim(),
        amount: amountNum,
        currency: "INR",
        splitType: "exact",
        payers: finalPayers,
        participants: participantsPayload,
        receiptData: items.length > 0 ? items : null,
      });
      router.push(`/groups/${groupId}`);
    } catch {
      setError("Couldn't save the expense on this device. Please try again.");
      setLoading(false);
    }
  }

  if (!authed) return null;

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] pb-24 font-[var(--font-inter)]">
        <PageHeader title={isEdit ? "Edit Expense" : "Add Expense"} onBack={() => router.back()} />

        {membersLoading ? (
          <div className="flex justify-center py-20">
            <div className="spinner border-[var(--accent)]" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-4 space-y-6 mt-4 max-w-md mx-auto">
            {repeatedFrom && (
              <div className="flex items-center gap-2 bg-[var(--accent-subtle)] text-[var(--accent)] p-3 rounded-xl text-sm font-semibold">
                <Repeat size={16} />
                {isEdit
                  ? <>Editing &quot;{repeatedFrom}&quot;. Changes apply to everyone&apos;s balance once saved.{keptBill && <> The order&apos;s item list stays saved as a record, but the split you set here replaces the item-by-item split.</>}</>
                  : <>Repeating &quot;{repeatedFrom}&quot;. Same people and shares. Change anything you like.</>}
              </div>
            )}

            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium border border-red-100">
                {error}
              </div>
            )}

            {/* Top Card: Basics */}
            <Card padding="lg" className="shadow-sm border-gray-100">
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    What was this for?
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. Dinner at Cafe"
                    autoFocus
                    className="w-full bg-gray-50 border-none rounded-xl p-3.5 text-base font-medium text-gray-900 focus:ring-2 focus:ring-[var(--accent)] focus:bg-white transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Total Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-gray-400">₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={totalAmount}
                      onChange={(e) => setTotalAmount(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0.01"
                      className="w-full bg-gray-50 border-none rounded-xl pl-10 pr-4 py-4 text-2xl font-black text-gray-900 focus:ring-2 focus:ring-[var(--accent)] focus:bg-white transition-all font-[var(--font-display)] tracking-tight"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                      Paid By
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsMultiPayer(!isMultiPayer)}
                      className="text-xs font-bold text-[var(--accent)] hover:underline"
                    >
                      {isMultiPayer ? "Single Payer" : "Multiple Payers"}
                    </button>
                  </div>
                  
                  {!isMultiPayer ? (
                    <div className="flex flex-wrap gap-2">
                      {members.map((m) => {
                        const isSelected = payerId === m.id;
                        return (
                          <button
                            key={`payer-${m.id}`}
                            type="button"
                            onClick={() => setPayerId(m.id)}
                            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all border ${
                              isSelected
                                ? "bg-[var(--accent)] text-white border-[var(--accent)] shadow-md shadow-orange-500/20"
                                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                            }`}
                          >
                            <MemberAvatar person={m} size={24} className={isSelected ? "ring-2 ring-white" : ""} />
                            {m.id === user?.id ? "You" : m.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-3 mt-3">
                      {members.map((m) => (
                        <div key={`mpayer-${m.id}`} className="flex items-center gap-3">
                          <div className="flex items-center gap-2 flex-1">
                            <MemberAvatar person={m} size={24} />
                            <span className="text-sm font-semibold text-gray-900">{m.id === user?.id ? "You" : m.name}</span>
                          </div>
                          <div className="w-28 relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-400">₹</span>
                            <input
                              type="number"
                              value={multiPayers[m.id]}
                              onChange={(e) => setMultiPayers({ ...multiPayers, [m.id]: e.target.value })}
                              placeholder="0.00"
                              className="w-full bg-gray-50 border-none rounded-lg pl-7 pr-3 py-2 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[var(--accent)] focus:bg-white outline-none tabular-nums"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* Items only some people had: taken off first, so nobody does it on a calculator */}
            <Card padding="lg" className="shadow-sm border-gray-100">
              <ItemsOnTop
                items={items}
                onChange={setItems}
                people={members}
                first={nameOf}
                split={split}
                restCount={sharedPoolParticipants.size}
              />
            </Card>

            {/* Middle Card: Group (Equal Split Foundation) */}
            <Card padding="lg" className="shadow-sm border-gray-100">
              <div className="flex items-center justify-between mb-3 gap-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                  {itemTotal > 0 ? "Split the rest between" : "Split Among"}
                </label>
                <span className="text-xs font-bold text-[var(--text-secondary)]">
                  {sharedPoolParticipants.size} of {members.length} selected
                </span>
              </div>

              {/* Quick controls: handy when a group is big */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={toggleAllVisible}
                  className="px-3 py-1.5 rounded-full text-xs font-bold bg-[var(--accent-subtle)] text-[var(--accent)] active:scale-95 transition-transform"
                >
                  {allVisibleSelected ? "Clear all" : "Select all"}
                  {splitSearch.trim() ? " shown" : ""}
                </button>
                {user && (
                  <button
                    type="button"
                    onClick={selectOnlyMe}
                    className="px-3 py-1.5 rounded-full text-xs font-bold bg-gray-100 text-gray-500 active:scale-95 transition-transform"
                  >
                    Only me
                  </button>
                )}
                {sharedPool > 0 && sharedPoolParticipants.size > 0 && (
                  <span className="ml-auto text-xs font-bold text-[var(--accent)] bg-orange-50 px-2 py-1 rounded-md">
                    {fmt(sharedPool)} to split
                  </span>
                )}
              </div>

              {members.length > 6 && (
                <div className="relative mb-3">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    value={splitSearch}
                    onChange={(e) => setSplitSearch(e.target.value)}
                    placeholder="Find a person"
                    aria-label="Find a person to include in the split"
                    className="w-full bg-gray-50 border-none rounded-xl pl-9 pr-3 py-2.5 text-sm font-medium text-gray-900 focus:ring-2 focus:ring-[var(--accent)] outline-none"
                  />
                </div>
              )}

              {sharedPool > 0 && sharedPoolParticipants.size === 0 && (
                <p role="alert" className="text-xs font-semibold text-[var(--negative)] mb-2">
                  Pick at least one person to split the remaining {fmt(sharedPool)}.
                </p>
              )}

              <div className="space-y-1 max-h-[26rem] overflow-y-auto">
                {visibleMembers.length === 0 && (
                  <p className="text-sm text-gray-400 py-3 text-center">No one matches &quot;{splitSearch}&quot;</p>
                )}
                {visibleMembers.map((m) => {
                  const isChecked = sharedPoolParticipants.has(m.id);
                  const finalShare = exactShares[m.id] || 0;
                  return (
                    <div
                      key={`split-${m.id}`}
                      role="checkbox"
                      aria-checked={isChecked}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleSharedPool(m.id); } }}
                      className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-xl cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      onClick={() => toggleSharedPool(m.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                          isChecked ? "bg-[var(--accent)] border-[var(--accent)]" : "bg-white border-gray-300"
                        }`}>
                          {isChecked && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                        </div>
                        <span className={`font-semibold ${finalShare > 0 || isChecked ? "text-gray-900" : "text-gray-400"}`}>
                          {m.id === user?.id ? "You" : m.name}
                        </span>
                      </div>
                      <span className="font-mono font-medium text-gray-500">{finalShare > 0 ? fmt(finalShare) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Save Button */}
            <div className="pt-6">
              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-4 rounded-2xl text-lg font-bold shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2"
              >
                {loading ? <div className="spinner border-white" style={{ width: 24, height: 24 }} /> : (isEdit ? `Save changes · ${fmt(amountNum)}` : `Save ${fmt(amountNum)}`)}
              </button>
            </div>
          </form>
        )}
      </main>
      <BottomNav />
    </>
  );
}
