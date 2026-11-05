"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRightLeft, Loader2, LogOut, X } from "lucide-react";

const noSubscribe = () => () => {};
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * Leave a group. Only allowed once you're settled up: with money still open it says how
 * much and sends you to Settle Up instead of offering a Leave button that would fail.
 */
export default function LeaveGroupSheet({
  groupId, groupName, signedBalance, isOnlyAdmin, onClose, onLeave,
}: {
  groupId: string;
  groupName: string;
  /** your balance here: + you get back, − you owe */
  signedBalance: number;
  isOnlyAdmin: boolean;
  onClose: () => void;
  /** resolves to an error message, or null when you've left */
  onLeave: () => Promise<string | null>;
}) {
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = Math.abs(signedBalance) >= 0.005;

  async function leave() {
    setBusy(true);
    setError(null);
    const err = await onLeave();
    if (err) { setError(err); setBusy(false); }
  }

  if (!isClient) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Leave ${groupName}`}
        className="w-full max-w-md bg-[var(--paper)] rounded-t-[28px]"
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <span className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${open ? "bg-[var(--accent-subtle)] text-[var(--accent)]" : "bg-[#F43F5E]/12 text-[#F43F5E]"}`}>
              {open ? <ArrowRightLeft size={19} /> : <LogOut size={19} />}
            </span>
            <div className="flex-1">
              <p className="font-bold text-[17px]">{open ? "Settle up before you leave" : `Leave ${groupName}?`}</p>
              <p className="text-[13.5px] text-[var(--text-secondary)] mt-1 leading-snug">
                {open
                  ? signedBalance < 0
                    ? <>You still owe <b className="text-[var(--negative)]">{inr(-signedBalance)}</b> in this group. Pay it and have it confirmed, then you can leave.</>
                    : <>You still get back <b className="text-[var(--positive)]">{inr(signedBalance)}</b> here. Once that&apos;s paid to you and confirmed, you can leave.</>
                  : <>You&apos;re settled up. Your past bills stay in the group&apos;s history, and you can be invited back later.</>}
              </p>
              {!open && isOnlyAdmin && (
                <p className="text-[12.5px] text-[var(--text-muted)] mt-2">You&apos;re the only admin, so the member who has been in the group longest becomes admin.</p>
              )}
            </div>
            <button onClick={onClose} className="p-1.5 text-[var(--text-muted)]" aria-label="Close"><X size={20} /></button>
          </div>
          {error && <p role="alert" className="mt-3 text-[13px] font-medium text-[var(--negative)]">{error}</p>}
        </div>

        <div className="px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] border-t border-[var(--hairline)] flex gap-3">
          <button onClick={onClose} className="px-5 py-3.5 rounded-[16px] bg-[var(--paper-dim)] font-bold text-[15px] text-[var(--text-secondary)]">
            {open ? "Close" : "Cancel"}
          </button>
          {open ? (
            <Link href={`/groups/${groupId}/settle`} className="flex-1 py-3.5 rounded-[16px] bg-[var(--accent)] text-white font-bold text-[15px] flex items-center justify-center gap-2">
              <ArrowRightLeft size={17} /> Go to Settle Up
            </Link>
          ) : (
            <button
              onClick={leave}
              disabled={busy}
              className="flex-1 py-3.5 rounded-[16px] bg-[#E11D48] text-white font-bold text-[15px] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={17} />} Leave group
            </button>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
