"use client";

import { useEffect, useMemo, useState } from "react";
import type { ParsedExpenseDraft, ExpenseCategory } from "@/hooks/types/ai";
import CategoryBadge from "./CategoryBadge";
import ReceiptItemAssigner from "./ReceiptItemAssigner";
import { AlertTriangle, Check, Loader2, Sparkles, User as UserIcon, Users, X } from "lucide-react";
import MemberAvatar from "@/components/ui/MemberAvatar";

interface Member {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  avatarKey?: string | null;
  isPlaceholder?: boolean;
}

interface ExpenseConfirmCardProps {
  draft: ParsedExpenseDraft;
  members: Member[];
  groupId: string;
  /** the signed-in person, shown as "You" */
  meId?: string;
  onConfirmed: () => void;
  onManual: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  onSubmit: (updated: ParsedExpenseDraft) => Promise<void>;
}

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * What the AI understood, ready to save: a plain sentence of the split at the top, then
 * what, how much, category, who paid and who shares it, all as tap-to-change pills.
 * Splits are "fairshare": personal amounts first (if any), the rest equally.
 */
export default function ExpenseConfirmCard({
  draft, members, meId, onManual, onCancel, isSubmitting, onSubmit,
}: ExpenseConfirmCardProps) {
  const [description, setDescription] = useState(draft.description);
  const [amount, setAmount] = useState(draft.amount ? String(draft.amount) : "");
  const [category, setCategory] = useState<ExpenseCategory | null>(draft.category);
  const [payers, setPayers] = useState(draft.payers);
  const [participants, setParticipants] = useState(draft.participants);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDescription(draft.description);
    setAmount(draft.amount ? String(draft.amount) : "");
    setCategory(draft.category);
    setPayers(draft.payers);
    setParticipants(draft.participants);
    setError(null);
  }, [draft]);

  // me first, then everyone else as the group names them
  const people = useMemo(() => [...members].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0)), [members, meId]);
  const label = (id: string) => (id === meId ? "You" : people.find((m) => m.id === id)?.name.split(" ")[0] ?? "Someone");
  const total = parseFloat(amount) || 0;

  const personal = participants.reduce((s, p) => s + (p.personalAmount || 0), 0);
  const each = participants.length ? Math.max(0, total - personal) / participants.length : 0;
  const shareOf = (id: string) => {
    const p = participants.find((x) => x.userId === id);
    return p ? (p.personalAmount || 0) + each : 0;
  };

  const toggleSharer = (id: string) =>
    setParticipants((prev) => (prev.some((p) => p.userId === id) ? prev.filter((p) => p.userId !== id) : [...prev, { userId: id }]));
  const setSharers = (ids: string[]) => setParticipants(ids.map((id) => participants.find((p) => p.userId === id) ?? { userId: id }));
  const pickPayer = (id: string) => {
    setPayers((prev) => {
      if (prev.length === 1 && prev[0].userId === id) return prev;
      if (prev.some((p) => p.userId === id)) return prev.filter((p) => p.userId !== id);
      // one payer is the usual case: tapping someone else makes them the payer
      return prev.length <= 1 ? [{ userId: id, amountPaid: total }] : [...prev, { userId: id, amountPaid: 0 }];
    });
  };
  const addPayer = (id: string) => setPayers((prev) => (prev.some((p) => p.userId === id) ? prev : [...prev, { userId: id, amountPaid: 0 }]));
  const setPaid = (id: string, v: string) => setPayers((prev) => prev.map((p) => (p.userId === id ? { ...p, amountPaid: parseFloat(v) || 0 } : p)));

  const everyone = people.map((m) => m.id);
  const isEveryone = participants.length === everyone.length;
  const isJustMe = participants.length === 1 && participants[0].userId === meId;
  const paidSum = payers.reduce((s, p) => s + (p.amountPaid || 0), 0);

  // "You paid ₹128 · split between You and Shan · ₹64 each"
  const sentence = (() => {
    if (!total) return "Add the amount to see the split.";
    const who = payers.length === 1 ? `${label(payers[0].userId)} paid ${money(total)}` : `${payers.length} people paid ${money(total)}`;
    if (participants.length === 0) return `${who} · pick who shares it`;
    if (participants.length === 1) return `${who} · all for ${label(participants[0].userId) === "You" ? "you" : label(participants[0].userId)}`;
    const names = isEveryone ? "everyone" : participants.map((p) => label(p.userId)).join(", ").replace(/, ([^,]*)$/, " and $1");
    return `${who} · split between ${names} · ${personal > 0 ? "see shares below" : `${money(Math.round(each * 100) / 100)} each`}`;
  })();

  async function handleConfirm() {
    setError(null);
    if (!description.trim()) return setError("Add what it was for.");
    if (!total || total <= 0) return setError("Add the amount.");
    if (payers.length === 0) return setError("Pick who paid.");
    if (participants.length === 0) return setError("Pick who shares it.");
    if (payers.length > 1 && Math.abs(paidSum - total) > 0.01) return setError(`What each person paid should add up to ${money(total)}.`);
    try {
      await onSubmit({
        ...draft,
        description: description.trim(),
        amount: total,
        currency: "INR",
        splitType: "fairshare",
        category,
        payers: payers.length === 1 ? [{ ...payers[0], amountPaid: total }] : payers,
        participants,
      });
    } catch (err) {
      setError((err as Error).message || "Couldn't save it. Try again.");
    }
  }

  const pill = "h-10 pl-1 pr-3 rounded-full flex items-center gap-2 text-[13.5px] font-bold border-2 transition-colors flex-shrink-0";
  const section = "text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2";

  return (
    <div className="rounded-[24px] bg-[var(--paper)] border border-[var(--hairline)] shadow-[var(--shadow-card)] overflow-hidden">
      {/* What the AI understood */}
      <div className="px-5 pt-4 pb-4 bg-[var(--accent-subtle)]">
        <div className="flex items-start gap-2">
          <Sparkles size={16} className="text-[var(--accent)] mt-0.5 flex-shrink-0" />
          <p className="flex-1 text-[12.5px] text-[var(--text-secondary)] italic leading-snug">&ldquo;{draft.rawText}&rdquo;</p>
          <button onClick={onCancel} className="p-1 -m-1 text-[var(--text-muted)]" aria-label="Start over"><X size={18} /></button>
        </div>
        <p className="mt-2.5 text-[15px] font-bold text-[var(--text-primary)] leading-snug">{sentence}</p>
      </div>

      <div className="px-5 py-4 space-y-5">
        {(draft.ambiguities.length > 0 || draft.possibleDuplicate || draft.confidence < 0.5) && (
          <div className="space-y-2">
            {draft.possibleDuplicate && (
              <p className="flex gap-2 text-[12.5px] p-3 rounded-[14px] bg-[var(--warn)]/10 text-[var(--text-primary)]">
                <AlertTriangle size={15} className="text-[var(--warn)] flex-shrink-0 mt-0.5" /> A bill like this was added in the last day. Check it isn&apos;t a repeat.
              </p>
            )}
            {draft.ambiguities.map((a, i) => (
              <p key={i} className="flex gap-2 text-[12.5px] p-3 rounded-[14px] bg-[var(--paper-dim)] text-[var(--text-secondary)]">
                <AlertTriangle size={15} className="text-[var(--accent)] flex-shrink-0 mt-0.5" /> {a}. Pick them below.
              </p>
            ))}
            {draft.confidence < 0.5 && draft.ambiguities.length === 0 && (
              <p className="flex gap-2 text-[12.5px] p-3 rounded-[14px] bg-[var(--paper-dim)] text-[var(--text-secondary)]">
                <AlertTriangle size={15} className="text-[var(--accent)] flex-shrink-0 mt-0.5" /> Not fully sure about this one. Check the details below.
              </p>
            )}
          </div>
        )}

        {/* What and how much */}
        <div className="flex gap-3">
          <label className="flex-1 min-w-0">
            <span className={`${section} block`}>For</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was it?"
              className="w-full h-12 px-3.5 rounded-[14px] bg-[var(--paper-dim)] text-[16px] font-bold outline-none border-2 border-transparent focus:border-[var(--accent)]"
            />
          </label>
          <label className="w-[38%] flex-shrink-0">
            <span className={`${section} block`}>Amount</span>
            <span className="h-12 px-3 rounded-[14px] bg-[var(--paper-dim)] flex items-center gap-1 border-2 border-transparent focus-within:border-[var(--accent)]">
              <span className="text-[var(--text-muted)] font-bold">₹</span>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="flex-1 min-w-0 bg-transparent text-[18px] font-black tabular-nums text-right outline-none"
              />
            </span>
          </label>
        </div>

        <div>
          <p className={section}>Category</p>
          <CategoryBadge value={category} onChange={setCategory} />
        </div>

        {draft.extractedItems && (
          <ReceiptItemAssigner
            items={draft.extractedItems}
            members={members}
            onChange={(next) => setParticipants(next)}
            onItemsChange={(items) => {
              const sum = items.reduce((a, it) => a + (it.amount || 0), 0);
              if (sum > total) setAmount(sum.toFixed(2));
            }}
          />
        )}

        {/* Who paid */}
        <div>
          <p className={section}>Paid by</p>
          <div className="flex flex-wrap gap-2">
            {people.map((m) => {
              const on = payers.some((p) => p.userId === m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pickPayer(m.id)}
                  aria-pressed={on}
                  className={`${pill} ${on ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--text-primary)]" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}
                >
                  <span className="w-8 h-8 flex-shrink-0 flex items-center justify-center"><MemberAvatar person={m} size={32} dim={!on} /></span>
                  {label(m.id)}
                  {on && <Check size={14} strokeWidth={3} className="text-[var(--accent)]" />}
                </button>
              );
            })}
          </div>
          {payers.length === 1 && people.length > 1 && (
            <button type="button" onClick={() => addPayer(people.find((m) => m.id !== payers[0].userId)!.id)} className="mt-2 text-[12px] font-bold text-[var(--accent)]">
              More than one person paid?
            </button>
          )}
          {payers.length > 1 && (
            <div className="mt-3 space-y-2">
              {payers.map((p) => (
                <label key={p.userId} className="flex items-center gap-3">
                  <span className="flex-1 text-[14px] font-semibold">{label(p.userId)} paid</span>
                  <span className="w-28 h-10 px-2.5 rounded-[12px] bg-[var(--paper-dim)] flex items-center gap-1">
                    <span className="text-[var(--text-muted)] font-bold">₹</span>
                    <input type="number" inputMode="decimal" value={p.amountPaid || ""} onChange={(e) => setPaid(p.userId, e.target.value)} placeholder="0" className="flex-1 min-w-0 bg-transparent text-[16px] font-bold text-right tabular-nums outline-none" />
                  </span>
                </label>
              ))}
              <p className={`text-[12px] text-right font-semibold ${Math.abs(paidSum - total) < 0.01 ? "text-[var(--positive)]" : "text-[var(--warn)]"}`}>
                {money(paidSum)} of {money(total)}
              </p>
            </div>
          )}
        </div>

        {/* Who shares it */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className={`${section} mb-0!`}>Split between</p>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setSharers(everyone)} className={`h-8 px-3 rounded-full text-[12px] font-bold flex items-center gap-1 border ${isEveryone ? "border-[var(--positive)] text-[var(--positive)] bg-[var(--positive)]/10" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}>
                <Users size={13} /> Everyone
              </button>
              {meId && (
                <button type="button" onClick={() => setSharers([meId])} className={`h-8 px-3 rounded-full text-[12px] font-bold flex items-center gap-1 border ${isJustMe ? "border-[var(--positive)] text-[var(--positive)] bg-[var(--positive)]/10" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}>
                  <UserIcon size={13} /> Just me
                </button>
              )}
            </div>
          </div>
          <div className="rounded-[16px] border border-[var(--hairline)] divide-y divide-[var(--hairline)] overflow-hidden">
            {people.map((m) => {
              const on = participants.some((p) => p.userId === m.id);
              const mine = participants.find((p) => p.userId === m.id)?.personalAmount || 0;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleSharer(m.id)}
                  aria-pressed={on}
                  className={`w-full px-3.5 py-2.5 flex items-center gap-3 text-left transition-colors ${on ? "bg-[var(--positive)]/[0.06]" : ""}`}
                >
                  <span className="w-9 h-9 flex-shrink-0 flex items-center justify-center"><MemberAvatar person={m} size={36} dim={!on} /></span>
                  <span className={`flex-1 min-w-0 text-[14.5px] font-bold truncate ${on ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>
                    {label(m.id)}
                    {mine > 0 && <span className="block text-[11.5px] font-medium text-[var(--text-secondary)]">incl. {money(mine)} of their own</span>}
                  </span>
                  <span className={`text-[15px] font-extrabold tabular-nums ${on ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] text-[12.5px] font-semibold"}`}>
                    {on ? money(Math.round(shareOf(m.id) * 100) / 100) : "not in it"}
                  </span>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${on ? "bg-[var(--positive)] border-[var(--positive)] text-white" : "border-[var(--hairline)]"}`}>
                    {on && <Check size={13} strokeWidth={3.5} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {error && <p className="text-[13px] font-semibold text-[var(--negative)] p-3 rounded-[14px] bg-[var(--negative)]/10">{error}</p>}

        <div className="space-y-2 pt-1">
          <button
            type="button"
            id="ai-confirm-btn"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="w-full h-14 rounded-[16px] bg-[var(--accent)] text-white text-[16px] font-extrabold flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.99] transition-transform"
          >
            {isSubmitting ? <><Loader2 size={18} className="animate-spin" /> Saving…</> : <><Check size={18} strokeWidth={3} /> Save{total ? ` ${money(total)}` : ""}</>}
          </button>
          <button type="button" onClick={onManual} className="w-full h-11 rounded-[14px] text-[14px] font-bold text-[var(--text-secondary)]">
            Open the full form instead
          </button>
        </div>
      </div>
    </div>
  );
}
