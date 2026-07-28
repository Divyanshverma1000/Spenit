"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAIExpense } from "@/hooks/useAIExpense";
import ExpenseConfirmCard from "@/components/ExpenseConfirmCard";
import BottomNav from "@/components/BottomNav";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Mic, Camera, Send, Sparkles } from "lucide-react";
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

  useEffect(() => {
    const t = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length);
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
        alert("Bring your own AI: Groq API Key required. Please set it in your Profile.");
        router.push("/profile");
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

  function handleReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      if (base64 && groupId) {
        setReceiptFile(file);
        setReceiptToast(true);
        setTimeout(() => setReceiptToast(false), 2500);
        await ai.parseReceipt(base64, groupId);
      }
    };
    reader.readAsDataURL(file);
  }

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
              <Card padding="md">
                <div className="relative">
                  {isListening ? (
                    <div className="min-h-[72px] flex flex-col gap-2">
                      <div className="flex gap-1 items-end h-6">
                        <span className="text-xs font-medium" style={{ color: "var(--negative)" }}>Listening...</span>
                      </div>
                      <p className="text-sm leading-relaxed min-h-[2.5rem]" style={{ color: "var(--text-primary)" }}>
                        {ai.liveTranscript || <span style={{ color: "var(--text-muted)" }}>Speak now...</span>}
                      </p>
                    </div>
                  ) : (
                      <textarea
                        rows={3}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={`e.g. "${PLACEHOLDER_EXAMPLES[placeholderIdx]}"`}
                        disabled={isParsing}
                        className="input-field w-full resize-none p-3"
                      />
                  )}
                </div>

                <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                  {ai.voiceSupported && (
                    <button
                      type="button"
                      onClick={() => isListening ? ai.stopVoice() : ai.startVoice(groupId)}
                      className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors"
                      style={isListening ? { backgroundColor: "var(--negative)", color: "var(--paper)", borderColor: "var(--negative)" } : {}}
                    >
                      <Mic className="h-3.5 w-3.5" strokeWidth={1.5} />
                      {isListening ? "Stop" : "Speak"}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-sm)]"
                  >
                    <Camera className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Receipt
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleReceiptChange} />

                  <button
                    type="button"
                    onClick={handleParse}
                    disabled={!text.trim() || isParsing || isListening}
                    className="btn-primary ml-auto flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-[var(--radius-sm)] disabled:opacity-40"
                  >
                    {isParsing ? <div className="spinner" style={{ width: "12px", height: "12px", borderWidth: "2px" }} /> : <Send className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    Parse
                  </button>
                </div>
              </Card>

              {!isParsing && text.length === 0 && (
                <Card padding="md">
                  <p className="text-xs font-medium mb-3" style={{ color: "var(--text-secondary)" }}>Try saying...</p>
                  <div className="space-y-1">
                    {PLACEHOLDER_EXAMPLES.map((ex, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setText(ex)}
                        className="w-full text-left text-xs py-2 px-2 rounded-[var(--radius-sm)] transition-colors"
                        style={{ color: "var(--text-primary)", backgroundColor: "var(--paper-dim)" }}
                      >
                        "{ex}"
                      </button>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}

          {isReview && ai.draft && (
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
          )}

          {isReview && (
            <Card padding="md">
              <p className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>Not right? Try rephrasing:</p>
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
