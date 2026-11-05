"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { ArrowRight, QrCode } from "lucide-react";

const noSubscribe = () => () => {};
const SEEN_KEY = "spenit-welcome-seen";

const CARDS = [
  {
    art: "/illustrations/home-hero.webp",
    title: "Split anything with your people",
    body: "Make a group for your flat, trip or office. Everyone sees the same bills and exactly who owes whom.",
  },
  {
    art: "/illustrations/home-orders.webp",
    title: "Drop your order screenshots",
    body: "Blinkit, Zepto, Instamart: Spenit reads every item. You tap who had what, and fees split fairly.",
  },
  {
    art: "/illustrations/welcome-settled.webp",
    title: "Settle up in a tap",
    body: "See who to pay, pay by UPI, done. And your own spending is tracked for you, without extra work.",
  },
];

export const welcomeSeen = () => {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
};
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode */ } };

/** First run: three cards, then "Create your first group" (or join with an invite). */
export default function Welcome({ onDone }: { onDone: () => void }) {
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const last = i === CARDS.length - 1;
  const go = (to: number) => { if (to < 0 || to >= CARDS.length) return; setDir(to > i ? 1 : -1); setI(to); };
  const close = () => { markSeen(); onDone(); };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -60 || info.velocity.x < -400) go(i + 1);
    else if (info.offset.x > 60 || info.velocity.x > 400) go(i - 1);
  };

  if (!isClient) return null;
  const c = CARDS[i];
  return createPortal(
    <div className="fixed inset-0 z-[95] bg-[var(--ink)] flex flex-col" role="dialog" aria-label="Welcome to Spenit">
      <div className="flex justify-end px-5 pt-[max(16px,env(safe-area-inset-top))]">
        {!last && <button onClick={close} className="px-3 py-2 text-[14px] font-semibold text-[var(--text-secondary)]">Skip</button>}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 overflow-hidden">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={i}
            custom={dir}
            initial={{ opacity: 0, x: dir * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -60 }}
            transition={{ duration: 0.28 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.25}
            onDragEnd={onDragEnd}
            className="w-full max-w-sm text-center touch-pan-y"
          >
            <div className="relative mx-auto w-[240px] h-[240px]">
              <div className="absolute inset-6 rounded-full bg-[#F59E0B] opacity-20 blur-3xl" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.art} alt="" draggable={false} className="relative w-full h-full object-contain select-none" />
            </div>
            <h1 className="mt-6 text-[26px] font-extrabold tracking-tight leading-tight text-[var(--text-primary)]">{c.title}</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-secondary)]">{c.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="px-6 pb-[max(24px,env(safe-area-inset-bottom))] max-w-sm w-full mx-auto">
        <div className="flex justify-center gap-2 mb-6" role="tablist" aria-label="Pages">
          {CARDS.map((_, k) => (
            <button
              key={k}
              onClick={() => go(k)}
              aria-label={`Page ${k + 1}`}
              aria-selected={k === i}
              role="tab"
              className={`h-2 rounded-full transition-all ${k === i ? "w-6 bg-[var(--accent)]" : "w-2 bg-[var(--border-dark)]"}`}
            />
          ))}
        </div>
        {last ? (
          <div className="space-y-2.5">
            <Link href="/groups/new" onClick={markSeen} className="w-full py-4 rounded-[18px] bg-[var(--accent)] text-white font-bold text-[16px] flex items-center justify-center gap-2 shadow-[0_10px_24px_-10px_rgba(245,158,11,0.7)]">
              Create your first group <ArrowRight size={18} />
            </Link>
            <Link href="/join/scan" onClick={markSeen} className="w-full py-3.5 rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] font-bold text-[15px] flex items-center justify-center gap-2">
              <QrCode size={17} /> I have an invite
            </Link>
            <button onClick={close} className="w-full py-2 text-[13.5px] font-semibold text-[var(--text-secondary)]">Look around first</button>
          </div>
        ) : (
          <button onClick={() => go(i + 1)} className="w-full py-4 rounded-[18px] bg-[var(--accent)] text-white font-bold text-[16px] flex items-center justify-center gap-2">
            Next <ArrowRight size={18} />
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
