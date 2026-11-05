"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Bug, CheckCircle2, Lightbulb, Loader2, MessageSquare, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";

const noSubscribe = () => () => {};
const KINDS = [
  { key: "problem", label: "Something's wrong", icon: Bug, hint: "What happened, and what did you expect? Which group or screen?" },
  { key: "idea", label: "An idea", icon: Lightbulb, hint: "What would make Spenit better for you?" },
  { key: "other", label: "Something else", icon: MessageSquare, hint: "Tell us anything." },
] as const;

/**
 * Report a problem or share an idea. Goes straight to the team (the admin dashboard and
 * a notification), with the screen you came from, the app version and the device type.
 */
export default function FeedbackSheet({
  from, onClose, initialMessage = "", label,
}: {
  from?: string;
  onClose: () => void;
  /** e.g. "[Test: Pay with a UPI app] " from the testing checklist */
  initialMessage?: string;
  /** shown under the title, e.g. which test this is about */
  label?: string;
}) {
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const { authFetch } = useAuth();
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("problem");
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const k = KINDS.find((x) => x.key === kind)!;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await authFetch("/feedback", {
          method: "POST",
          body: JSON.stringify({ kind, message, page: from ?? null, appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev" }),
        })
      );
      setSent(true);
    } catch (err) {
      setError((err as Error).message || "Couldn't send. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  if (!isClient) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Report a problem or share an idea"
        className="w-full max-w-md bg-[var(--paper)] rounded-t-[28px] max-h-[90dvh] flex flex-col"
      >
        {sent ? (
          <div className="p-6 pb-[max(24px,env(safe-area-inset-bottom))] text-center">
            <CheckCircle2 size={40} className="mx-auto text-[#16A34A]" />
            <p className="mt-3 font-bold text-[18px]">Thank you!</p>
            <p className="mt-1 text-[14px] text-[var(--text-secondary)]">We read every message. If we need more detail, we&apos;ll reach out to the email on your account.</p>
            <button onClick={onClose} className="mt-5 w-full py-3.5 rounded-[16px] bg-[var(--accent)] text-white font-bold text-[15px]">Done</button>
          </div>
        ) : (
          <>
            <div className="p-5 pb-3 overflow-y-auto">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-[17px]">Tell us</p>
                  <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">{label ?? "Goes straight to the people who build Spenit."}</p>
                </div>
                <button onClick={onClose} className="p-1.5 -mr-1.5 text-[var(--text-muted)]" aria-label="Close"><X size={20} /></button>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {KINDS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setKind(key)}
                    aria-pressed={kind === key}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-[14px] border-2 text-[12px] font-bold ${kind === key ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--text-primary)]" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}
                  >
                    <Icon size={18} className={kind === key ? "text-[var(--accent)]" : ""} /> {label}
                  </button>
                ))}
              </div>
              <textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                placeholder={k.hint}
                rows={5}
                className="mt-3 w-full px-4 py-3 rounded-[16px] bg-[var(--paper-dim)] text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)]"
              />
              <p className="mt-1.5 text-[11.5px] text-[var(--text-muted)]">We also send which screen you were on, the app version and your device type, nothing else.</p>
              {error && <p role="alert" className="mt-2 text-[13px] font-medium text-[var(--negative)]">{error}</p>}
            </div>
            <div className="px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] border-t border-[var(--hairline)] flex gap-3">
              <button onClick={onClose} className="px-5 py-3.5 rounded-[16px] bg-[var(--paper-dim)] font-bold text-[15px] text-[var(--text-secondary)]">Cancel</button>
              <button
                onClick={send}
                disabled={message.trim().length < 3 || busy}
                className="flex-1 py-3.5 rounded-[16px] bg-[var(--accent)] text-white font-bold text-[15px] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {busy && <Loader2 size={16} className="animate-spin" />} Send
              </button>
            </div>
          </>
        )}
      </motion.div>
    </div>,
    document.body
  );
}
