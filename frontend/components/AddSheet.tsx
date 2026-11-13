"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRightLeft, Camera, ChevronRight, PencilLine, Sparkles, X } from "lucide-react";

const noSubscribe = () => () => {};

/**
 * Every way to add spending to a group, in one place (CAPTURE_PLAN.md):
 * a picture of anything (bill, receipt, order, payment), a sentence, a form, or a
 * payment back to someone.
 */
export default function AddSheet({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!isClient) return null;

  const options = [
    {
      href: `/groups/${groupId}/import`,
      icon: Camera,
      tint: "#F59E0B",
      title: "Scan or upload",
      body: "A bill, receipt, order or UPI payment. Spenit reads it, you tap who had what.",
      primary: true,
    },
    {
      href: `/groups/${groupId}/expenses/ai`,
      icon: Sparkles,
      tint: "#8B5CF6",
      title: "Type it",
      body: "\"Dinner 1,200, I paid, split with everyone\"",
    },
    {
      href: `/groups/${groupId}/expenses/new`,
      icon: PencilLine,
      tint: "#14B8A6",
      title: "Enter by hand",
      body: "Amount, who paid, who shares. Cash and anything without a picture.",
    },
    {
      href: `/groups/${groupId}/settle`,
      icon: ArrowRightLeft,
      tint: "#3B82F6",
      title: "Record a payment",
      body: "You paid someone back, or they paid you.",
    },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", bounce: 0.15, duration: 0.35 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Add to this group"
        className="w-full max-w-md bg-[var(--paper)] rounded-t-[28px] pb-[max(16px,env(safe-area-inset-bottom))]"
      >
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <p className="font-bold text-[17px]">Add</p>
          <button onClick={onClose} className="p-1.5 -mr-1.5 text-[var(--text-muted)]" aria-label="Close"><X size={20} /></button>
        </div>
        <div className="px-4 pb-2 space-y-2">
          {options.map(({ href, icon: Icon, tint, title, body, primary }) => (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3.5 p-3.5 rounded-[18px] border active:scale-[0.99] transition-transform ${primary ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : "border-[var(--hairline)]"}`}
            >
              <span className="w-11 h-11 rounded-[14px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${tint}1F`, color: tint }}>
                <Icon size={21} strokeWidth={2.3} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-bold text-[var(--text-primary)]">{title}</span>
                <span className="block text-[12.5px] text-[var(--text-secondary)] leading-snug">{body}</span>
              </span>
              <ChevronRight size={18} className="text-[var(--text-muted)] flex-shrink-0" />
            </Link>
          ))}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
