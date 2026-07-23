"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAIExpense } from "@/hooks/useAIExpense";
import ExpenseConfirmCard from "@/components/ExpenseConfirmCard";
import BottomNav from "@/components/BottomNav";
import type { ParsedExpenseDraft } from "@/hooks/types/ai";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface Member {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

const PLACEHOLDER_EXAMPLES = [
  "Dinner 900 Rahul paid",
  "Hotel 8000 split equally",
  "Cab 450 between Aman and me",
  "Pizza 1400 everyone except Mohit",
  "Coffee 300 exact: Riya 150, me 150",
];

/**
 * AI Expense Entry Page (/groups/[id]/expenses/ai)
 *
 * Architecture §2: This page is the front-door shortcut. It produces a draft
 * that the user can edit. The ONLY save path is POST /expenses via
 * useAIExpense.submitDraft → ExpenseConfirmCard.onSubmit.
 *
 * Fallback: any AI failure → navigate to manual form with amount pre-filled.
 * Never show a broken screen (Usecase_Flow Scenario D).
 */
export default function AIExpensePage() {
  const { id: groupId } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const { accessToken } = useAuth();
  const router = useRouter();

  const [members, setMembers] = useState<Member[]>([]);
  const [groupName, setGroupName] = useState("");
  const [text, setText] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptToast, setReceiptToast] = useState(false);
  const [successToast, setSuccessToast] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ai = useAIExpense();

  // Cycle through example placeholders
  useEffect(() => {
    const t = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length);
    }, 3000);
    return () => clearInterval(t);
  }, []);

  // Fetch group members for context
  useEffect(() => {
    if (!accessToken || !groupId) return;
    fetch(`${API_URL}/groups/${groupId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setMembers(data.members || []);
        setGroupName(data.name || "");
      })
      .catch(console.error);
  }, [accessToken, groupId]);

  // Handle AI fallback → redirect to manual form
  useEffect(() => {
    if (ai.state === "fallback" && ai.fallbackData) {
      const reason = ai.fallbackData.reason;
      
      if (reason === "config_error") {
        alert("Bring your own AI: Groq API Key required. Please set it in your Profile.");
        router.push("/profile");
        return;
      }

      const toastMsg =
        reason === "timeout"
          ? "AI timed out — using manual form"
          : reason === "rate_limit"
          ? "AI rate limit reached — using manual form"
          : "AI unavailable — using manual form";

      // Brief delay so user sees the toast before redirect
      const amount = ai.fallbackData.partialAmount || "";
      setTimeout(() => {
        router.push(
          `/groups/${groupId}/expenses/new${amount ? `?amount=${amount}` : ""}`
        );
      }, 1800);

      // Show inline toast before redirecting
      console.log("[ai] fallback:", reason, toastMsg);
    }
  }, [ai.state, ai.fallbackData, groupId, router]);

  // Handle done → navigate back to group
  useEffect(() => {
    if (ai.state === "done") {
      setSuccessToast(true);
      setTimeout(() => router.push(`/groups/${groupId}`), 1500);
    }
  }, [ai.state, groupId, router]);

  // ── Receipt upload handler ─────────────────────────────────────────────────
  function handleReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptFile(file);
    // Phase 6B stub: show toast, redirect to manual
    setReceiptToast(true);
    setTimeout(() => {
      setReceiptToast(false);
      router.push(`/groups/${groupId}/expenses/new`);
    }, 2500);
  }

  // ── Handle parse ──────────────────────────────────────────────────────────
  async function handleParse() {
    if (!text.trim() || ai.state === "parsing") return;
    await ai.parse(text, groupId);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleParse();
    }
  }

  // ── Manual form redirect with current text amount pre-filled ─────────────
  function goManual() {
    const amount = ai.draft?.amount || ai.fallbackData?.partialAmount || "";
    router.push(
      `/groups/${groupId}/expenses/new${amount ? `?amount=${amount}` : ""}`
    );
  }

  if (!authed) return null;

  const isReview = ai.state === "review" && ai.draft;
  const isParsing = ai.state === "parsing";
  const isListening = ai.state === "listening";
  const isFallback = ai.state === "fallback";

  return (
    <>
      <main className="min-h-screen bg-[#0a0a12] page-content pb-24">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="px-5 pt-14 pb-4 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white">✨ AI Expense Entry</h1>
            {groupName && (
              <p className="text-xs text-slate-500 truncate">{groupName}</p>
            )}
          </div>
          <button
            onClick={goManual}
            className="text-xs text-slate-500 hover:text-slate-300 border border-white/10 rounded-lg px-3 py-1.5 transition-colors"
          >
            Manual
          </button>
        </div>

        {/* ── Success toast ─────────────────────────────────────────────── */}
        {successToast && (
          <div className="mx-5 mb-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 p-3">
            <p className="text-sm text-emerald-300 font-medium text-center">
              ✅ Expense saved!
            </p>
          </div>
        )}

        {/* ── Fallback toast ────────────────────────────────────────────── */}
        {isFallback && (
          <div className="mx-5 mb-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 p-3">
            <p className="text-xs text-amber-300 font-medium text-center">
              AI unavailable — redirecting to manual form…
            </p>
          </div>
        )}

        {/* ── Receipt toast ─────────────────────────────────────────────── */}
        {receiptToast && (
          <div className="mx-5 mb-4 rounded-2xl bg-violet-500/10 border border-violet-500/20 p-3">
            <p className="text-xs text-violet-300 text-center">
              📸 Receipt scanning coming soon — opening manual form…
            </p>
          </div>
        )}

        {/* ── Main content ─────────────────────────────────────────────── */}
        <div className="px-5 space-y-4">

          {/* ── Input area (hidden when reviewing) ────────────────────── */}
          {!isReview && (
            <>
              {/* Text input */}
              <div className="glass-card p-4">
                <div className="relative">
                  {/* Live voice transcript overlay — shown while listening */}
                  {isListening ? (
                    <div className="min-h-[72px] flex flex-col gap-2">
                      {/* Waveform bars */}
                      <div className="flex gap-1 items-end h-6">
                        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                          <div
                            key={i}
                            className="w-1 bg-rose-500 rounded-full animate-pulse"
                            style={{
                              height: `${8 + ((i * 7) % 16)}px`,
                              animationDelay: `${i * 0.12}s`,
                            }}
                          />
                        ))}
                        <span className="text-xs text-rose-400 ml-2 self-center">Listening…</span>
                      </div>
                      {/* Live transcript text */}
                      <p className="text-sm text-white/80 leading-relaxed min-h-[2.5rem]">
                        {ai.liveTranscript || (
                          <span className="text-slate-600 italic">Speak now — tap Stop when done…</span>
                        )}
                      </p>
                    </div>
                  ) : (
                  <textarea
                    id="ai-text-input"
                    rows={3}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`e.g. "${PLACEHOLDER_EXAMPLES[placeholderIdx]}"`}
                    disabled={isParsing}
                    className="w-full bg-transparent text-white placeholder-slate-600 text-sm resize-none focus:outline-none leading-relaxed"
                  />
                  )}
                </div>

                {/* Action row */}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                  {/* Voice button */}
                  {ai.voiceSupported && (
                    <button
                      id="voice-btn"
                      type="button"
                      onClick={() =>
                        isListening ? ai.stopVoice() : ai.startVoice(groupId)
                      }
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all ${
                        isListening
                          ? "bg-rose-500/25 text-rose-300 border border-rose-500/40 scale-105"
                          : "bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                      }`}
                    >
                      {isListening ? (
                        <>
                          <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
                          Stop &amp; Parse
                        </>
                      ) : (
                        <>
                          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4zm-2 6a5 5 0 0010 0h1a6 6 0 01-12 0h1z" />
                          </svg>
                          Speak
                        </>
                      )}
                    </button>
                  )}

                  {/* Receipt upload */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Receipt
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleReceiptChange}
                  />

                  {receiptFile && (
                    <span className="text-xs text-slate-500 truncate flex-1">
                      {receiptFile.name}
                    </span>
                  )}

                  {/* Parse button */}
                  <button
                    id="ai-parse-btn"
                    type="button"
                    onClick={handleParse}
                    disabled={!text.trim() || isParsing || isListening}
                    className="ml-auto btn-primary px-4 py-2 text-xs font-semibold flex items-center gap-2 disabled:opacity-40"
                  >
                    {isParsing ? (
                      <>
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        Parsing…
                      </>
                    ) : (
                      <>
                        <span>✨</span>
                        Parse
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* ── How it works hint ───────────────────────────────────── */}
              {!isParsing && text.length === 0 && (
                <div className="glass-card p-4">
                  <p className="text-xs font-medium text-slate-400 mb-3">
                    💡 Try saying…
                  </p>
                  <div className="space-y-2">
                    {PLACEHOLDER_EXAMPLES.map((ex, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setText(ex)}
                        className="w-full text-left text-xs text-slate-500 hover:text-slate-300 py-1.5 px-3 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        &ldquo;{ex}&rdquo;
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Confirm Card ─────────────────────────────────────────── */}
          {isReview && ai.draft && (
            <div className="glass-card p-5">
              <ExpenseConfirmCard
                draft={ai.draft}
                members={members}
                groupId={groupId}
                onConfirmed={() => {}}
                onManual={goManual}
                onCancel={() => ai.reset()}
                isSubmitting={ai.state === "submitting"}
                onSubmit={async (updated: ParsedExpenseDraft) => {
                  await ai.submitDraft(updated, groupId);
                }}
              />
            </div>
          )}

          {/* ── Re-parse area (shown when reviewing) ────────────────── */}
          {isReview && (
            <div className="glass-card p-4">
              <p className="text-xs text-slate-500 mb-2">Not right? Try rephrasing:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleParse(); }
                  }}
                  placeholder="Rephrase your expense…"
                  className="flex-1 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
                />
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={!text.trim() || isParsing}
                  className="btn-primary px-4 py-2 text-xs disabled:opacity-40"
                >
                  ✨ Re-parse
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
