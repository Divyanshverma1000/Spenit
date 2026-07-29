"use client";

import { useState, useEffect } from "react";
import type { ParsedExpenseDraft, ExpenseCategory } from "@/hooks/types/ai";
import CategoryBadge from "./CategoryBadge";
import ReceiptItemAssigner from "./ReceiptItemAssigner";
import { Sparkles, AlertTriangle, Equal, Hash, Target, Check } from "lucide-react";

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
  const [splitType, setSplitType] = useState<"equal" | "exact" | "fairshare">("fairshare");
  const [category, setCategory] = useState<ExpenseCategory | null>(draft.category);
  const [payers, setPayers] = useState(draft.payers);
  const [participants, setParticipants] = useState(draft.participants);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDescription(draft.description);
    setAmount(formatAmount(draft.amount));
    setSplitType("fairshare");
    setCategory(draft.category);
    setPayers(draft.payers);
    setParticipants(draft.participants);
    setError(null);
  }, [draft]);

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

  function updateShareAmount(userId: string, val: string) {
    setParticipants((prev) =>
      prev.map((p) =>
        p.userId === userId ? { ...p, shareAmount: parseFloat(val) || 0 } : p
      )
    );
  }

  async function handleConfirm() {
    setError(null);
    const numAmount = parseFloat(amount);
    if (!description.trim()) { setError("Description is required"); return; }
    if (!amount || isNaN(numAmount) || numAmount <= 0) { setError("Amount must be a positive number"); return; }
    if (payers.length === 0) { setError("At least one payer is required"); return; }
    if (participants.length === 0) { setError("At least one participant is required"); return; }

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

  const totalPersonal = participants.reduce((sum, p) => sum + (p.personalAmount || 0), 0);
  const remainingShared = Math.max(0, numAmount - totalPersonal);
  const equalSharedPortion = participants.length > 0 ? remainingShared / participants.length : 0;

  return (
    <div className="card p-5 space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--accent)] font-semibold mb-0.5 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4" strokeWidth={1.5} /> AI parsed your expense
          </p>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed max-w-xs italic">
            &ldquo;{draft.rawText}&rdquo;
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Low-confidence warning ─────────────────────────────────────────── */}
      {isLowConfidence && (
        <div className="rounded-[var(--radius-md)] bg-amber-500/10 border border-amber-500/20 p-3 flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
          <p className="text-xs text-amber-600 font-medium">
            Low confidence — please review carefully before confirming
          </p>
        </div>
      )}

      {/* ── Duplicate warning ─────────────────────────────────────────────── */}
      {draft.possibleDuplicate && (
        <div className="rounded-[var(--radius-md)] bg-orange-500/10 border border-orange-500/20 p-3 flex gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
          <p className="text-xs text-orange-600 font-medium">
            Possible duplicate — a similar expense was added in the last 24h. Continue?
          </p>
        </div>
      )}

      {/* ── Ambiguities ───────────────────────────────────────────────────── */}
      {draft.ambiguities.length > 0 && (
        <div className="rounded-[var(--radius-md)] bg-[var(--paper-dim)] border border-[var(--border)] p-3 space-y-2">
          {draft.ambiguities.map((a, i) => (
            <div key={i} className="flex gap-2 text-xs text-[var(--text-secondary)]">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
              <p>{a}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Description ───────────────────────────────────────────────────── */}
      <div>
        <label className="section-label mb-1.5 block">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What was this expense for?"
          className="input-field"
        />
      </div>

      {/* ── Amount ────────────────────────────────────────────────────────── */}
      <div>
        <label className="section-label mb-1.5 block">Total Amount (₹)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          min="0"
          step="0.01"
          className="input-field tabular-nums font-medium"
        />
      </div>

      {/* ── Category ─────────────────────────────────────────────────────── */}
      <div>
        <label className="section-label mb-2 block">Category</label>
        <CategoryBadge value={category} onChange={setCategory} />
      </div>

      {/* ── Split type (Forced to Fairshare) ─────────────────────────────── */}
      <div className="hidden">
        <label className="section-label mb-1.5 block">Split type</label>
        {/* We keep splitType in state as 'fairshare' implicitly or explicitly */}
      </div>

      {/* ── Extracted Receipt Items (if any) ────────────────────────────── */}
      {draft.extractedItems && draft.extractedItems.length > 0 && (
        <ReceiptItemAssigner 
          items={draft.extractedItems}
          members={members}
          onChange={(newParticipants) => setParticipants(newParticipants)}
        />
      )}

      {/* ── Payers ───────────────────────────────────────────────────────── */}
      <div>
        <label className="section-label mb-2 block">Who paid?</label>
        <div className="space-y-2">
          {members.map((m) => {
            const payer = payers.find((p) => p.userId === m.id);
            return (
              <div key={m.id} className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => togglePayer(m.id)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors flex-shrink-0 ${payer ? "bg-[var(--accent)] text-[var(--paper)]" : "bg-[var(--paper-dim)] text-[var(--text-secondary)] border border-[var(--border)]"}`}
                >
                  {m.name.charAt(0).toUpperCase()}
                </button>
                <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">{m.name}</span>
                {payer && payers.length > 1 && (
                  <input
                    type="number"
                    value={payer.amountPaid || ""}
                    onChange={(e) => updatePayerAmount(m.id, e.target.value)}
                    placeholder="Amount"
                    min="0"
                    step="0.01"
                    className="input-field w-24 px-2 py-1.5 text-xs text-right tabular-nums"
                  />
                )}
                {payer && payers.length === 1 && (
                  <span className="text-sm font-medium tabular-nums text-[var(--text-secondary)]">₹{numAmount.toFixed(2)}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Participants ─────────────────────────────────────────────────── */}
      <div>
        <label className="section-label mb-2 block">Split between</label>
        <div className="space-y-2">
          {members.map((m) => {
            const included = isParticipant(m.id);
            const participant = participants.find((p) => p.userId === m.id);
            const participantShare = splitType === "fairshare" 
              ? (participant?.personalAmount || 0) + equalSharedPortion
              : equalSharedPortion;

            return (
              <div key={m.id} className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => toggleParticipant(m.id)}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors flex-shrink-0 ${included ? "bg-[var(--positive)] text-[var(--paper)]" : "bg-[var(--paper-dim)] text-[var(--text-secondary)] border border-[var(--border)]"}`}
                >
                  {m.name.charAt(0).toUpperCase()}
                </button>
                <span className={`flex-1 text-sm font-medium ${included ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>{m.name}</span>
                {included && splitType === "exact" && (
                  <input
                    type="number"
                    value={participant?.shareAmount ?? ""}
                    onChange={(e) => updateShareAmount(m.id, e.target.value)}
                    placeholder="Share"
                    min="0"
                    step="0.01"
                    className="input-field w-24 px-2 py-1.5 text-xs text-right tabular-nums"
                  />
                )}
                {included && (splitType === "equal" || splitType === "fairshare") && (
                  <div className="flex flex-col items-end">
                    <span className="text-sm font-medium text-[var(--positive)] tabular-nums">
                      ₹{participantShare.toFixed(2)}
                    </span>
                    {splitType === "fairshare" && (participant?.personalAmount || 0) > 0 && (
                      <span className="text-[10px] text-[var(--text-secondary)]">
                        (₹{(participant?.personalAmount || 0).toFixed(2)} personal)
                      </span>
                    )}
                  </div>
                )}
                {included && splitType === "exact" && participant?.shareAmount !== undefined && participant.shareAmount > 0 && (
                  <Check className="h-4 w-4 text-[var(--accent)] ml-2" strokeWidth={2} />
                )}
                {!included && (
                  <span className="text-xs text-[var(--text-muted)]">excluded</span>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Split summary ─────────────────────────────────────────────── */}
        {participants.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--border)] flex justify-between text-xs">
            <span className="text-[var(--text-secondary)] font-medium">
              {participants.length} {participants.length === 1 ? "person" : "people"}
              {splitType === "fairshare" ? " sharing" : " splitting equally"}
            </span>
            <span className={`font-semibold tabular-nums ${
              splitType === "exact"
                ? Math.abs(participants.reduce((s, p) => s + (p.shareAmount || 0), 0) - numAmount) < 0.01
                  ? "text-[var(--positive)]"
                  : "text-amber-600"
                : "text-[var(--text-secondary)]"
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
        <div className="rounded-[var(--radius-md)] bg-[var(--negative)]/10 border border-[var(--negative)]/20 p-3">
          <p className="text-xs text-[var(--negative)] font-medium">{error}</p>
        </div>
      )}

      {/* ── Small confidence indicator ───────────────────────────────────── */}
      <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)] pt-2">
        <span>AI confidence: {Math.round(draft.confidence * 100)}%</span>
        <div className="w-24 h-1.5 rounded-full bg-[var(--paper-dim)] overflow-hidden">
          <div
            className={`h-full rounded-full ${draft.confidence > 0.7 ? "bg-[var(--positive)]" : draft.confidence > 0.4 ? "bg-amber-500" : "bg-[var(--negative)]"}`}
            style={{ width: `${draft.confidence * 100}%` }}
          />
        </div>
      </div>

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-3">
        <button
          type="button"
          onClick={onManual}
          className="btn-secondary flex-1 py-3 text-sm font-semibold"
        >
          Edit manually
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSubmitting}
          id="ai-confirm-btn"
          className="btn-primary flex-1 py-3 text-sm font-semibold disabled:opacity-50"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="spinner" />
              Saving…
            </span>
          ) : (
            "Confirm"
          )}
        </button>
      </div>
    </div>
  );
}
