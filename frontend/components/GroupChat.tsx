"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ArrowUp, ListFilter, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  expenseIds?: string[];
  followUps?: string[];
  error?: boolean;
}

const SUGGESTIONS = [
  "What's still pending?",
  "Who owes me and how much?",
  "How much did we spend on milk?",
  "What did I spend on vegetables?",
  "Biggest expense this month?",
];

const noSubscribe = () => () => {};
const storeKey = (groupId: string) => `spenit-chat-${groupId}`;

function load(groupId: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(storeKey(groupId));
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}
function save(groupId: string, msgs: ChatMessage[]) {
  try { sessionStorage.setItem(storeKey(groupId), JSON.stringify(msgs.slice(-30))); } catch { /* private mode */ }
}

/** **bold**, "- " bullets and line breaks — all the formatting the assistant uses. */
function Rich({ text }: { text: string }) {
  const inline = (s: string, k: number) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={`${k}-${i}`} className="font-bold">{part.slice(2, -2)}</strong> : <React.Fragment key={`${k}-${i}`}>{part}</React.Fragment>
    );
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: React.ReactNode[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`ul${out.length}`} className="list-disc pl-5 space-y-0.5 my-1">{list}</ul>);
    list = [];
  };
  lines.forEach((l, i) => {
    const m = l.match(/^\s*[-*•]\s+(.*)/);
    if (m) { list.push(<li key={i}>{inline(m[1], i)}</li>); return; }
    flush();
    if (l.trim()) out.push(<p key={i} className="my-0.5">{inline(l, i)}</p>);
  });
  flush();
  return <>{out}</>;
}

/**
 * Chat with Spenit about one group. The server answers from the group's full ledger
 * (balances, pending payments, every bill and its items); the last few turns go along
 * so follow-ups work. The thread lives in this tab's session.
 */
export default function GroupChat({
  groupId, groupName, initialQuestion, onClose, onShowExpenses,
}: {
  groupId: string;
  groupName: string;
  initialQuestion?: string;
  onClose: () => void;
  onShowExpenses: (ids: string[]) => void;
}) {
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const { authFetch } = useAuth();
  const [msgs, setMsgs] = useState<ChatMessage[]>(() => (typeof window === "undefined" ? [] : load(groupId)));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  useEffect(() => { save(groupId, msgs); }, [groupId, msgs]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  async function ask(question: string, base: ChatMessage[] = msgs) {
    const q = question.trim();
    if (!q || busy) return;
    const thread: ChatMessage[] = [...base, { role: "user", content: q }];
    setMsgs(thread);
    setInput("");
    setBusy(true);
    setStatus(null);
    const history = base.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await authFetch("/ai/query", { method: "POST", body: JSON.stringify({ groupId, question: q, history }) });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setMsgs([...thread, { role: "assistant", content: data.answer, expenseIds: data.expenseIds ?? [], followUps: data.followUps ?? [] }]);
          return;
        }
        if (data.error === "rate_limit" && attempt === 0) {
          const wait = Math.min(Math.max(data.retryAfterMs || 8000, 3000), 30000);
          setStatus(`The AI is busy. Trying again in ${Math.round(wait / 1000)}s…`);
          await new Promise((r) => setTimeout(r, wait));
          setStatus(null);
          continue;
        }
        const message =
          data.error === "missing_key" ? "Add your Groq API key in Profile to use the assistant."
          : data.error === "rate_limit" ? "The AI is busy right now. Try again in a minute."
          : data.error === "timeout" ? "That took too long. Try again."
          : data.message || data.error || "Something went wrong.";
        setMsgs([...thread, { role: "assistant", content: message, error: true }]);
        return;
      }
    } catch {
      setMsgs([...thread, { role: "assistant", content: "You're offline. Connect to the internet and try again.", error: true }]);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  // A question typed in the group page's search bar starts the chat.
  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      void ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  function retryLast() {
    const lastUser = [...msgs].reverse().findIndex((m) => m.role === "user");
    if (lastUser < 0) return;
    const idx = msgs.length - 1 - lastUser;
    void ask(msgs[idx].content, msgs.slice(0, idx));
  }

  if (!isClient) return null;
  const last = msgs[msgs.length - 1];

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40" onClick={onClose}>
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Ask Spenit"
        className="w-full max-w-md h-[88vh] h-[88dvh] bg-[var(--paper)] rounded-t-[28px] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 py-3 flex items-center gap-3 border-b border-[var(--hairline)]">
          <span className="w-9 h-9 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center"><Sparkles size={18} /></span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-[16px] leading-tight">Ask Spenit</p>
            <p className="text-[12px] text-[var(--text-secondary)] truncate">Knows every bill, item and payment in {groupName}</p>
          </div>
          {msgs.length > 0 && (
            <button onClick={() => setMsgs([])} className="p-2 text-[var(--text-muted)]" aria-label="Clear chat"><Trash2 size={18} /></button>
          )}
          <button onClick={onClose} className="p-2 text-[var(--text-muted)]" aria-label="Close"><X size={20} /></button>
        </div>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-[var(--paper-dim)]">
          {msgs.length === 0 && (
            <div className="pt-6 text-center">
              <span className="mx-auto w-14 h-14 rounded-[18px] bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center"><Sparkles size={26} /></span>
              <p className="mt-3 font-bold text-[17px]">What do you want to know?</p>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)] px-6">Who owes what, what&apos;s pending, or how much went on milk, snacks or veggies.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => ask(s)} className="px-3 py-2 rounded-full bg-[var(--paper)] border border-[var(--hairline)] text-[13px] font-semibold text-[var(--text-primary)] active:scale-95 transition-transform">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[82%] px-3.5 py-2.5 rounded-[18px] rounded-br-[6px] bg-[var(--accent)] text-white text-[14px] font-medium leading-snug whitespace-pre-wrap">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="flex gap-2 items-start">
                <span className="mt-1 w-6 h-6 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center flex-shrink-0"><Sparkles size={13} /></span>
                <div className="max-w-[86%] min-w-0">
                  <div className={`px-3.5 py-2.5 rounded-[18px] rounded-tl-[6px] text-[14px] leading-snug border ${m.error ? "bg-[var(--paper)] border-[var(--negative)]/30 text-[var(--negative)]" : "bg-[var(--paper)] border-[var(--hairline)] text-[var(--text-primary)]"}`}>
                    <Rich text={m.content} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {m.error && i === msgs.length - 1 && (
                      <button onClick={retryLast} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-bold bg-[var(--paper)] border border-[var(--hairline)]">
                        <RotateCcw size={12} /> Try again
                      </button>
                    )}
                    {!!m.expenseIds?.length && (
                      <button onClick={() => onShowExpenses(m.expenseIds!)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-bold text-[var(--accent)] bg-[var(--accent-subtle)]">
                        <ListFilter size={12} /> Show {m.expenseIds.length} {m.expenseIds.length === 1 ? "bill" : "bills"}
                      </button>
                    )}
                    {i === msgs.length - 1 && !busy && m.followUps?.map((f) => (
                      <button key={f} onClick={() => ask(f)} className="px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[var(--paper)] border border-[var(--hairline)] text-[var(--text-secondary)] text-left">
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )
          )}

          {busy && (
            <div className="flex gap-2 items-center">
              <span className="w-6 h-6 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center"><Sparkles size={13} /></span>
              <div className="px-3.5 py-3 rounded-[18px] rounded-tl-[6px] bg-[var(--paper)] border border-[var(--hairline)] flex items-center gap-1">
                {status ? <span className="text-[13px] text-[var(--text-secondary)]">{status}</span> : [0, 1, 2].map((d) => (
                  <motion.span key={d} className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: d * 0.18 }} />
                ))}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        <form
          onSubmit={(e) => { e.preventDefault(); void ask(input); }}
          className="px-3 pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))] border-t border-[var(--hairline)] flex items-end gap-2 bg-[var(--paper)]"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
            rows={1}
            placeholder={last?.role === "assistant" ? "Ask a follow-up…" : "Ask about this group…"}
            className="flex-1 resize-none max-h-28 px-4 py-3 rounded-[20px] bg-[var(--paper-dim)] text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)]"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="w-11 h-11 rounded-full bg-[var(--accent)] text-white flex items-center justify-center disabled:opacity-40 flex-shrink-0"
            aria-label="Send"
          >
            <ArrowUp size={20} strokeWidth={2.6} />
          </button>
        </form>
      </motion.div>
    </div>,
    document.body
  );
}
