"use client";

import { API_URL } from "@/lib/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAIExpense } from "@/hooks/useAIExpense";
import ExpenseConfirmCard from "@/components/ExpenseConfirmCard";
import ListeningSheet from "@/components/ListeningSheet";
import StoryReview from "@/components/StoryReview";
import { looksLikeStory, toExpenseBody, type StoryBill } from "@/lib/story";
import { groupKey } from "@/lib/queries";
import BottomNav from "@/components/BottomNav";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Mic, Camera, Sparkles, Loader2, ArrowRight } from "lucide-react";
import type { ParsedExpenseDraft } from "@/hooks/types/ai";
import { ask, toast } from "@/lib/dialog";


interface Member {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}


export default function AIExpensePage() {
  const { id: groupId } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const { accessToken, user, authFetch } = useAuth();
  const queryClient = useQueryClient();

  // ── Story mode: a whole day in one go → several bills to review ─────────────
  const [story, setStory] = useState<{ bills: StoryBill[]; unclear: string[] } | null>(null);
  const [storyBusy, setStoryBusy] = useState(false);
  const [storySaving, setStorySaving] = useState(false);
  const [storyError, setStoryError] = useState<string | null>(null);
  const storyKey = useRef<string>("");

  async function readStory(said: string) {
    setStoryBusy(true);
    setStoryError(null);
    try {
      const res = await authFetch("/ai/parse-story", { method: "POST", body: JSON.stringify({ text: said, groupId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "missing_key") { router.push("/profile"); return; }
        toast(data.message || "Couldn't read that story. Try again.", "error");
        return;
      }
      if (!data.bills?.length) { toast("Couldn't find any amounts in that. Try saying what each thing cost.", "error"); return; }
      storyKey.current = crypto.randomUUID();
      setStory({ bills: data.bills, unclear: data.unclear ?? [] });
      window.scrollTo({ top: 0 });
    } catch {
      toast("Couldn't reach Spenit. Check your connection.", "error");
    } finally {
      setStoryBusy(false);
    }
  }

  async function saveStory() {
    if (!story) return;
    setStorySaving(true);
    setStoryError(null);
    const live = story.bills.filter((b) => !b.skip);
    const group = live.filter((b) => !b.toPersonal);
    const mine = live.filter((b) => b.toPersonal);
    try {
      if (group.length) {
        const res = await authFetch("/expenses/batch", {
          method: "POST",
          headers: { "Idempotency-Key": storyKey.current },
          body: JSON.stringify({ groupId, expenses: group.map(toExpenseBody) }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          const which = typeof e.index === "number" && group[e.index] ? `${group[e.index].description}: ` : "";
          throw new Error(`${which}${e.error || "Couldn't save the bills"}`);
        }
      }
      for (const b of mine) {
        await authFetch("/personal_expenses", { method: "POST", body: JSON.stringify({ description: b.description, amount: b.amount, category: b.category }) });
      }
      queryClient.invalidateQueries({ queryKey: groupKey(groupId) });
      queryClient.invalidateQueries({ queryKey: ["balance"] });
      toast(`Saved ${live.length} ${live.length === 1 ? "bill" : "bills"} from your day`);
      router.push(`/groups/${groupId}`);
    } catch (err) {
      setStoryError((err as Error).message);
    } finally {
      setStorySaving(false);
    }
  }
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
    if (!text.trim() || ai.state === "parsing" || storyBusy) return;
    // Two or more amounts: a story of several bills; otherwise one bill.
    if (looksLikeStory(text)) await readStory(text.trim());
    else await ai.parse(text, groupId);
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
          {story && user && (
            <StoryReview
              bills={story.bills}
              setBills={(fn) => setStory((st) => (st ? { ...st, bills: fn(st.bills) } : st))}
              members={members}
              meId={user.id}
              unclear={story.unclear}
              saving={storySaving}
              error={storyError}
              onSave={() => void saveStory()}
              onStartOver={() => { setStory(null); setStoryError(null); }}
            />
          )}

          {storyBusy && (
            <section className="rounded-[24px] bg-[var(--paper)] border border-[var(--hairline)] p-5 flex items-center gap-3">
              <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
              <div>
                <p className="font-bold text-[15px]">Reading your day…</p>
                <p className="text-[12.5px] text-[var(--text-secondary)]">Finding each bill, who paid and who shares it.</p>
              </div>
            </section>
          )}

          {!isReview && !story && !storyBusy && (
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
                        onClick={() => ai.startVoice(groupId, (heard) => {
                          setText(heard);
                          if (!looksLikeStory(heard)) return false;
                          void readStory(heard);
                          return true;
                        })}
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
                  <button
                    type="button"
                    onClick={() => setText(`We went to the mall, I bought a jacket for 2500. Then movies, I paid 900 for all of us. ${examples[0].includes("between") ? examples[0].split(" between ")[1].split(" and ")[0] : "Rahul"} paid 2400 for dinner, and the cab home was 380, I paid.`)}
                    className="mt-3 w-full p-4 rounded-[18px] bg-[var(--accent-subtle)] text-left active:scale-[0.99] transition-transform"
                  >
                    <p className="text-[13.5px] font-extrabold text-[var(--text-primary)] flex items-center gap-1.5"><Sparkles size={15} className="text-[var(--accent)]" /> Tell your whole day in one go</p>
                    <p className="mt-0.5 text-[12.5px] text-[var(--text-secondary)] leading-snug">
                      Tap the mic and talk through it: what you bought, who paid, who shared, extras like &ldquo;Shan had an extra ice cream&rdquo;. Spenit makes each bill for you to check. Tap here for an example.
                    </p>
                  </button>
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
      {!story && <BottomNav />}
    </>
  );
}
