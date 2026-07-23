"use client";

import { useState, useEffect } from "react";
import type { ParsedExpenseDraft, ExpenseCategory } from "@/hooks/types/ai";
import CategoryBadge from "./CategoryBadge";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Member {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

interface ExpenseConfirmCardProps {
  draft: ParsedExpenseDraft;
  members: Member[];
  groupId: string;
  /** Called after successful POST /expenses */
  onConfirmed: () => void;
  /** Called if user presses "Edit manually" */
  onManual: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  onSubmit: (updated: ParsedExpenseDraft) => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function memberName(members: Member[], id: string): string {
  const m = members.find((m) => m.id === id);
  return m?.name || id.slice(0, 8);
}

function formatAmount(n: number | null): string {
  if (n === null) return "";
  return n.toFixed(2);
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * ExpenseConfirmCard — the AI-to-manual bridge.
 *
 * Architecture §2: This card pre-fills the Stage 3 form with AI data.
 * The user can edit EVERYTHING. Pressing Confirm calls POST /expenses via
 * the onSubmit callback — never through a new endpoint.
 * This is literally the same data structure POST /expenses expects.
 */
export default function ExpenseConfirmCard({
  draft,
  members,
  onManual,
  onCancel,
  isSubmitting,
  onSubmit,
}: ExpenseConfirmCardProps) {
  // ── Editable state — pre-filled from AI draft ─────────────────────────────
  const [description, setDescription] = useState(draft.description);
  const [amount, setAmount] = useState(formatAmount(draft.amount));
  const [splitType, setSplitType] = useState<"equal" | "exact" | "fairshare">(draft.splitType);
  const [category, setCategory] = useState<ExpenseCategory | null>(draft.category);
  const [payers, setPayers] = useState(draft.payers);
  const [participants, setParticipants] = useState(draft.participants);
  const [error, setError] = useState<string | null>(null);

  // Re-sync if draft changes (e.g., user re-parsed)
  useEffect(() => {
    setDescription(draft.description);
    setAmount(formatAmount(draft.amount));
    setSplitType(draft.splitType);
    setCategory(draft.category);
    setPayers(draft.payers);
    setParticipants(draft.participants);
    setError(null);
  }, [draft]);

  // ── Participant toggle ────────────────────────────────────────────────────
  function toggleParticipant(userId: string) {
    setParticipants((prev) => {
      const exists = prev.find((p) => p.userId === userId);
      if (exists) {
        return prev.filter((p) => p.userId !== userId);
      }
      return [...prev, { userId }];
    });
  }

  function isParticipant(userId: string) {
    return participants.some((p) => p.userId === userId);
  }

  // ── Payer amount change ───────────────────────────────────────────────────
  function updatePayerAmount(userId: string, val: string) {
    setPayers((prev) =>
      prev.map((p) =>
        p.userId === userId ? { ...p, amountPaid: parseFloat(val) || 0 } : p
      )
    );
  }

  function togglePayer(userId: string) {
    setPayers((prev) => {
      const exists = prev.find((p) => p.userId === userId);
      if (exists) return prev.filter((p) => p.userId !== userId);
      return [...prev, { userId, amountPaid: 0 }];
    });
  }

  // ── Exact share amount ────────────────────────────────────────────────────
  function updateShareAmount(userId: string, val: string) {
    setParticipants((prev) =>
      prev.map((p) =>
        p.userId === userId ? { ...p, shareAmount: parseFloat(val) || 0 } : p
      )
    );
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleConfirm() {
    setError(null);
    const numAmount = parseFloat(amount);
    if (!description.trim()) { setError("Description is required"); return; }
    if (!amount || isNaN(numAmount) || numAmount <= 0) { setError("Amount must be a positive number"); return; }
    if (payers.length === 0) { setError("At least one payer is required"); return; }
    if (participants.length === 0) { setError("At least one participant is required"); return; }

    // Auto-fill single payer
    const finalPayers = payers.map((p) => ({
      ...p,
      amountPaid: payers.length === 1 ? numAmount : p.amountPaid,
    }));

    const updated: ParsedExpenseDraft = {
      ...draft,
      description: description.trim(),
      amount: numAmount,
      currency: "INR",
      splitType,
      category,
      payers: finalPayers,
      participants,
    };

    try {
      await onSubmit(updated);
    } catch (err) {
      setError((err as Error).message || "Failed to save expense");
    }
  }

  const numAmount = parseFloat(amount) || 0;
  const isLowConfidence = draft.confidence < 0.4;

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-violet-400 font-medium mb-0.5 flex items-center gap-1.5">
            <span>✨</span> AI parsed your expense
          </p>
          <p className="text-xs text-slate-500 leading-relaxed max-w-xs">
            &ldquo;{draft.rawText}&rdquo;
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-slate-600 hover:text-slate-400 text-xl leading-none flex-shrink-0"
        >
          ×
        </button>
      </div>

      {/* ── Low-confidence warning ─────────────────────────────────────────── */}
      {isLowConfidence && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
          <p className="text-xs text-amber-300 font-medium">
            ⚠ Low confidence — please review carefully before confirming
          </p>
        </div>
      )}

      {/* ── Duplicate warning ─────────────────────────────────────────────── */}
      {draft.possibleDuplicate && (
        <div className="rounded-xl bg-orange-500/10 border border-orange-500/20 p-3">
          <p className="text-xs text-orange-300 font-medium">
            🔁 Possible duplicate — a similar expense was added in the last 24h. Continue?
          </p>
        </div>
      )}

      {/* ── Ambiguities ───────────────────────────────────────────────────── */}
      {draft.ambiguities.length > 0 && (
        <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-3 space-y-1">
          {draft.ambiguities.map((a, i) => (
            <p key={i} className="text-xs text-slate-400">
              ⚠ {a}
            </p>
          ))}
        </div>
      )}

      {/* ── Description ───────────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">
          Description
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What was this expense for?"
          className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
        />
      </div>

      {/* ── Amount ────────────────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">
          Total Amount (₹)
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          min="0"
          step="0.01"
          className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
        />
      </div>

      {/* ── Category ─────────────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">
          Category
        </label>
        <CategoryBadge value={category} onChange={setCategory} />
      </div>

      {/* ── Split type ───────────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">
          Split type
        </label>
        <div className="flex gap-2">
          {(["equal", "exact", "fairshare"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSplitType(mode)}
              className={`flex-1 rounded-xl py-2 text-xs font-medium transition-colors border ${splitType === mode ? "border-violet-500/50 bg-violet-500/15 text-violet-300" : "border-white/5 text-slate-500 hover:bg-white/5"}`}
            >
              {mode === "equal" ? "⚡ Equal" : mode === "exact" ? "🔢 Exact" : "🎯 Fairshare"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Payers ───────────────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">
          Who paid?
        </label>
        <div className="space-y-2">
          {members.map((m) => {
            const payer = payers.find((p) => p.userId === m.id);
            return (
              <div key={m.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => togglePayer(m.id)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors flex-shrink-0 ${payer ? "bg-violet-600 text-white" : "bg-white/5 text-slate-600 border border-white/10"}`}
                >
                  {m.name.charAt(0).toUpperCase()}
                </button>
                <span className="flex-1 text-sm text-slate-300">{m.name}</span>
                {payer && payers.length > 1 && (
                  <input
                    type="number"
                    value={payer.amountPaid || ""}
                    onChange={(e) => updatePayerAmount(m.id, e.target.value)}
                    placeholder="Amount"
                    min="0"
                    step="0.01"
                    className="w-24 rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs text-white placeholder-slate-600 text-right focus:outline-none focus:border-violet-500/50"
                  />
                )}
                {payer && payers.length === 1 && (
                  <span className="text-xs text-slate-500">₹{numAmount.toFixed(2)}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Participants ─────────────────────────────────────────────────── */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">
          Split between
        </label>
        <div className="space-y-2">
          {members.map((m) => {
            const included = isParticipant(m.id);
            const participant = participants.find((p) => p.userId === m.id);
            const equalShare =
              participants.length > 0 ? numAmount / participants.length : 0;

            return (
              <div key={m.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleParticipant(m.id)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors flex-shrink-0 ${included ? "bg-emerald-600 text-white" : "bg-white/5 text-slate-600 border border-white/10"}`}
                >
                  {m.name.charAt(0).toUpperCase()}
                </button>
                <span className="flex-1 text-sm text-slate-300">{m.name}</span>
                {included && splitType === "exact" && (
                  <input
                    type="number"
                    value={participant?.shareAmount ?? ""}
                    onChange={(e) => updateShareAmount(m.id, e.target.value)}
                    placeholder="Share"
                    min="0"
                    step="0.01"
                    className="w-24 rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-xs text-white placeholder-slate-600 text-right focus:outline-none focus:border-violet-500/50"
                  />
                )}
                {/* Show calculated share for equal + fairshare modes */}
                {included && (splitType === "equal" || splitType === "fairshare") && (
                  <span className="text-xs font-medium text-emerald-400">
                    ₹{equalShare.toFixed(2)}
                  </span>
                )}
                {/* Exact: show existing shareAmount if already filled */}
                {included && splitType === "exact" && participant?.shareAmount !== undefined && participant.shareAmount > 0 && (
                  <span className="text-xs text-violet-400 ml-1">
                    ✓
                  </span>
                )}
                {!included && (
                  <span className="text-xs text-slate-700">excluded</span>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Split summary ─────────────────────────────────────────────── */}
        {participants.length > 0 && (
          <div className="mt-2 pt-2 border-t border-white/5 flex justify-between text-xs">
            <span className="text-slate-500">
              {participants.length} {participants.length === 1 ? "person" : "people"}
              {splitType === "fairshare" ? " sharing" : " splitting equally"}
            </span>
            <span className={`font-medium ${
              splitType === "exact"
                ? Math.abs(participants.reduce((s, p) => s + (p.shareAmount || 0), 0) - numAmount) < 0.01
                  ? "text-emerald-400"
                  : "text-amber-400"
                : "text-slate-400"
            }`}>
              {splitType === "exact"
                ? `₹${participants.reduce((s, p) => s + (p.shareAmount || 0), 0).toFixed(2)} / ₹${numAmount.toFixed(2)}`
                : `₹${(numAmount / participants.length).toFixed(2)} each`
              }
            </span>
          </div>
        )}
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3">
          <p className="text-xs text-rose-400">{error}</p>
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onManual}
          className="flex-1 rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-medium text-slate-400 hover:bg-white/10 transition-colors"
        >
          Edit manually
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSubmitting}
          id="ai-confirm-btn"
          className="flex-1 btn-primary py-3 text-sm font-semibold disabled:opacity-50"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Saving…
            </span>
          ) : (
            "✓ Confirm"
          )}
        </button>
      </div>

      {/* ── Small confidence indicator ───────────────────────────────────── */}
      <div className="flex items-center justify-between text-xs text-slate-700">
        <span>AI confidence: {Math.round(draft.confidence * 100)}%</span>
        <div className="w-24 h-1 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full rounded-full ${draft.confidence > 0.7 ? "bg-emerald-500" : draft.confidence > 0.4 ? "bg-amber-500" : "bg-rose-500"}`}
            style={{ width: `${draft.confidence * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
