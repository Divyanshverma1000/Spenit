"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Mic, X } from "lucide-react";
import { BackClose } from "@/lib/backClose";

/**
 * Speaking an expense: a sheet with a glowing mic, sound bars that move while words come
 * in, the words as they are heard, and three ticks (amount, who paid, who shares) so people
 * know what to say. Done hands the words over; Cancel or back throws them away.
 */
export default function ListeningSheet({
  transcript, names, example, onDone, onCancel,
}: {
  transcript: string;
  /** first names in this group, to notice "who shares" */
  names: string[];
  example: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  // The bars jump for a moment whenever new words arrive.
  const [lively, setLively] = useState(false);
  const last = useRef("");
  useEffect(() => {
    if (transcript === last.current) return;
    last.current = transcript;
    const on = setTimeout(() => setLively(true), 0);
    const off = setTimeout(() => setLively(false), 900);
    return () => { clearTimeout(on); clearTimeout(off); };
  }, [transcript]);

  const t = ` ${transcript.toLowerCase()} `;
  const ticks = [
    { label: "Amount", on: /\d/.test(t) },
    { label: "Who paid", on: /\b(paid|pay|gave|my treat|on me)\b/.test(t) },
    {
      label: "Who shares",
      on: /\b(between|with|everyone|everybody|all of us|except|just me|only me|split|and me|me and)\b/.test(t) ||
        names.some((n) => n.length > 2 && t.includes(` ${n.toLowerCase()}`)),
    },
  ];

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/55" onClick={onCancel}>
      <BackClose onClose={onCancel} />
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 28, stiffness: 340 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Listening"
        className="w-full max-w-md bg-[var(--paper)] rounded-t-[32px] px-6 pt-3 pb-[max(22px,env(safe-area-inset-bottom))] flex flex-col items-center"
      >
        <div className="h-1 w-10 rounded-full bg-[var(--hairline)]" aria-hidden />

        <p className="mt-4 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--negative)]">
          <span className="w-2 h-2 rounded-full bg-[var(--negative)] motion-safe:animate-pulse" /> Listening
        </p>

        {/* The mic, glowing */}
        <div className="relative mt-6 w-[132px] h-[132px] flex items-center justify-center" aria-hidden>
          {[0, 0.6, 1.2].map((d) => (
            <span
              key={d}
              className="absolute inset-0 rounded-full motion-safe:animate-ping"
              style={{ background: "var(--accent)", opacity: 0.18, animationDuration: "2.4s", animationDelay: `${d}s` }}
            />
          ))}
          <span className="absolute inset-[14px] rounded-full" style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)" }} />
          <span
            className="relative w-[84px] h-[84px] rounded-full flex items-center justify-center text-white shadow-[0_12px_30px_-6px_rgba(245,158,11,0.6)]"
            style={{ background: "linear-gradient(145deg, #FBBF24, #F59E0B 55%, #D97706)" }}
          >
            <Mic size={34} strokeWidth={2.2} />
          </span>
        </div>

        {/* Sound bars */}
        <div className="mt-5 h-8 flex items-center gap-[5px]" aria-hidden>
          {[0.55, 0.85, 1, 0.7, 0.95, 0.6, 0.8].map((h, i) => (
            <span
              key={i}
              className="w-[5px] rounded-full bg-[var(--accent)] origin-center"
              style={{
                height: `${Math.round(h * 32)}px`,
                animation: `spenit-eq ${lively ? 0.42 + i * 0.05 : 1.3 + i * 0.12}s ease-in-out ${i * 0.07}s infinite`,
                opacity: lively ? 1 : 0.45,
                transition: "opacity 300ms",
              }}
            />
          ))}
        </div>

        {/* What was heard */}
        <p className="mt-5 min-h-[64px] w-full text-center text-[22px] font-bold leading-snug text-[var(--text-primary)]" aria-live="polite">
          {transcript ? transcript : <span className="text-[var(--text-muted)] font-semibold text-[18px]">Try &ldquo;{example}&rdquo;</span>}
        </p>

        {/* What it listens for */}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {ticks.map(({ label, on }) => (
            <span
              key={label}
              className={`h-8 px-3 rounded-full text-[12.5px] font-bold flex items-center gap-1.5 border transition-colors duration-300 ${
                on ? "border-[var(--positive)] text-[var(--positive)] bg-[var(--positive)]/10" : "border-[var(--hairline)] text-[var(--text-muted)]"
              }`}
            >
              <span className={`w-4 h-4 rounded-full flex items-center justify-center ${on ? "bg-[var(--positive)] text-white" : "border border-[var(--hairline)]"}`}>
                {on && <Check size={10} strokeWidth={4} />}
              </span>
              {label}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-[var(--text-muted)] text-center">Pause when you&apos;re done, or tap Done.</p>

        <div className="mt-6 w-full grid grid-cols-[1fr_1.6fr] gap-3">
          <button onClick={onCancel} className="h-14 rounded-[18px] bg-[var(--paper-dim)] text-[15px] font-bold text-[var(--text-secondary)] flex items-center justify-center gap-1.5">
            <X size={17} /> Cancel
          </button>
          <button onClick={onDone} className="h-14 rounded-[18px] bg-[var(--accent)] text-white text-[16px] font-extrabold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
            <Check size={18} strokeWidth={3} /> Done
          </button>
        </div>
      </motion.div>
    </div>
  );
}
