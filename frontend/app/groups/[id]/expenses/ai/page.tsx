"use client";

import { API_URL } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAIExpense } from "@/hooks/useAIExpense";
import ExpenseConfirmCard from "@/components/ExpenseConfirmCard";
import ListeningSheet from "@/components/ListeningSheet";
import BottomNav from "@/components/BottomNav";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Mic, Camera, Sparkles, Loader2, ArrowRight } from "lucide-react";
import type { ParsedExpenseDraft } from "@/hooks/types/ai";
import { ask } from "@/lib/dialog";


interface Member {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}


export default function AIExpensePage() {
  const { id: groupId } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const { accessToken, user } = useAuth();
  const router = useRouter();

  const [members, setMembers] = useState<Member[]>([]);
  const [groupName, setGroupName] = useState("");
  const [text, setText] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [receiptToast, setReceiptToast] = useState(false);
  const [successToast, setSuccessToast] = useState(false);

  const ai = useAIExpense();

  // Examples with this group's own names, so people see how to say it.
  const examples = useMemo(() => {
    const others = members.filter((m) => m.id !== user?.id).map((m) => m.name.split(" ")[0]);
    const a = others[0] ?? "Rahul", b = others[1] ?? others[0] ?? "Aman";
    return [
      `Cab 450 between ${a} and me`,
      `Dinner 1200 ${a} paid, split with everyone`,
      `Groceries 860 everyone except ${b}`,
      `Coffee 300 just me`,
    ];
  }, [members, user?.id]);

  useEffect(() => {
    const t = setInterval(() => {
      setPlaceholderIdx((i) => i + 1);
    }, 3000);
    return () => clearInterval(t);
  }, []);

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

  useEffect(() => {
    if (ai.state === "fallback" && ai.fallbackData) {
      const reason = ai.fallbackData.reason;
      if (reason === "config_error") {
        void ask({
          title: "Add an AI key first",
          body: "Typing expenses needs a free Groq key. You can add it in Profile in under a minute.",
          confirmLabel: "Open Profile",
          cancelLabel: "Not now",
        }).then((go) => { if (go) router.push("/profile"); });
        return;
      }
      const amount = ai.fallbackData.partialAmount || "";
      setTimeout(() => {
        router.push(`/groups/${groupId}/expenses/new${amount ? `?amount=${amount}` : ""}`);
      }, 1800);
    }
  }, [ai.state, ai.fallbackData, groupId, router]);

  useEffect(() => {
    if (ai.state === "done") {
      setSuccessToast(true);
      setTimeout(() => router.push(`/groups/${groupId}`), 1500);
    }
  }, [ai.state, groupId, router]);

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

  function goManual() {
    const amount = ai.draft?.amount || ai.fallbackData?.partialAmount || "";
    router.push(`/groups/${groupId}/expenses/new${amount ? `?amount=${amount}` : ""}`);
  }

  if (!authed) return null;

  const isReview = ai.state === "review" && ai.draft;
  const isParsing = ai.state === "parsing";
  const isListening = ai.state === "listening";
  const isFallback = ai.state === "fallback";

  return (
    <>
      <main className="min-h-screen page-content pb-24" style={{ backgroundColor: "var(--ink)" }}>
        <PageHeader 
          title="AI Expense" 
          subtitle={groupName}
          onBack={() => router.back()} 
          rightAction={
            <button onClick={goManual} className="btn-secondary px-3 py-1 text-xs">
              Manual
            </button>
          }
        />

        {successToast && (
          <div className="mx-4 mb-4 p-3 rounded-[var(--radius-sm)] text-center text-sm font-medium" style={{ backgroundColor: "var(--paper-dim)", color: "var(--positive)" }}>
            Expense saved!
          </div>
        )}
        {isFallback && (
          <div className="mx-4 mb-4 p-3 rounded-[var(--radius-sm)] text-center text-xs font-medium" style={{ backgroundColor: "var(--paper-dim)", color: "var(--text-primary)" }}>
            AI unavailable — redirecting to manual form...
          </div>
        )}
        {receiptToast && (
          <div className="mx-4 mb-4 p-3 rounded-[var(--radius-sm)] text-center text-xs font-medium" style={{ backgroundColor: "var(--paper-dim)", color: "var(--text-primary)" }}>
            Scanning Receipt...
          </div>
        )}

        <div className="px-4 space-y-4">
          {!isReview && (
            <>
              <section className="rounded-[24px] bg-[var(--paper)] border border-[var(--hairline)] shadow-[var(--shadow-card)] p-4">
                {(
                  <textarea
                    rows={3}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`e.g. "${examples[placeholderIdx % examples.length]}"`}
                    disabled={isParsing}
                    className="w-full resize-none bg-transparent text-[18px] font-semibold leading-snug outline-none placeholder:text-[var(--text-muted)] placeholder:font-medium"
                    aria-label="Describe the expense"
                  />
                )}

                {(
                  <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-[var(--hairline)]">
                    {ai.voiceSupported && (
                      <button
                        type="button"
                        onClick={() => ai.startVoice(groupId, (heard) => setText(heard))}
                        disabled={isParsing}
                        className="w-12 h-12 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform disabled:opacity-40"
                        aria-label="Speak the expense"
                      >
                        <Mic size={20} strokeWidth={2.2} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => router.push(`/groups/${groupId}/import`)}
                      className="h-12 px-4 rounded-full border-2 border-[var(--hairline)] text-[13.5px] font-bold text-[var(--text-secondary)] flex items-center gap-1.5 flex-shrink-0"
                    >
                      <Camera size={16} /> Scan
                    </button>
                    <button
                      type="button"
                      onClick={handleParse}
                      disabled={!text.trim() || isParsing}
                      className="ml-auto h-12 px-5 rounded-full bg-[var(--accent)] text-white text-[15px] font-extrabold flex items-center gap-2 disabled:opacity-40 active:scale-[0.98] transition-transform"
                    >
                      {isParsing ? <><Loader2 size={17} className="animate-spin" /> Reading…</> : <>Split it <ArrowRight size={17} strokeWidth={2.6} /></>}
                    </button>
                  </div>
                )}
              </section>

              {isListening && (
                <ListeningSheet
                  transcript={ai.liveTranscript}
                  names={members.map((m) => m.name.split(" ")[0])}
                  example={examples[0]}
                  onDone={() => ai.stopVoice()}
                  onCancel={() => ai.cancelVoice()}
                />
              )}

              {!isParsing && !isListening && text.length === 0 && (
                <section>
                  <p className="px-1 mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Try saying</p>
                  <div className="flex flex-wrap gap-2">
                    {examples.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => setText(ex)}
                        className="px-3.5 py-2.5 rounded-[14px] bg-[var(--paper)] border border-[var(--hairline)] text-[13.5px] font-semibold text-left text-[var(--text-primary)] active:scale-[0.98] transition-transform"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                  <p className="px-1 mt-3 text-[12px] text-[var(--text-muted)] leading-snug">
                    Use any name people go by here, nickname or real name. Say who paid and who shares it; if you don&apos;t, it&apos;s you paying and everyone sharing.
                  </p>
                </section>
              )}
            </>
          )}

          {isReview && ai.draft && (
            <ExpenseConfirmCard
              draft={ai.draft}
              members={members}
              groupId={groupId}
              meId={user?.id}
              onConfirmed={() => {}}
              onManual={goManual}
              onCancel={() => ai.reset()}
              isSubmitting={ai.state === "submitting"}
              onSubmit={async (updated: ParsedExpenseDraft) => {
                await ai.submitDraft(updated, groupId);
              }}
            />
          )}

          {isReview && (
            <Card padding="md">
              <p className="text-[12.5px] font-semibold mb-2 text-[var(--text-secondary)]">Not quite right? Say it differently:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleParse(); }
                  }}
                  placeholder="Rephrase..."
                  className="input-field flex-1"
                />
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={!text.trim() || isParsing}
                  className="btn-primary px-3 text-xs"
                >
                  <Sparkles className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            </Card>
          )}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
