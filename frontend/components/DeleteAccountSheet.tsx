"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";
import { useBackClose } from "@/lib/backClose";

const noSubscribe = () => () => {};

/** Delete my account: says exactly what happens, then asks to type DELETE. */
export default function DeleteAccountSheet({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  useBackClose(onClose);
  const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
  const { authFetch } = useAuth();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await readJson(await authFetch("/users/me", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) }));
      onDeleted();
    } catch (err) {
      setError((err as Error).message || "Couldn't delete your account. Check your connection and try again.");
      setBusy(false);
    }
  }

  if (!isClient) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Delete your account"
        className="w-full max-w-md bg-[var(--paper)] rounded-t-[28px] max-h-[90dvh] flex flex-col"
      >
        <div className="p-5 overflow-y-auto">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-full bg-[#F43F5E]/12 text-[#F43F5E] flex items-center justify-center flex-shrink-0"><AlertTriangle size={20} /></span>
            <div className="flex-1">
              <p className="font-bold text-[17px]">Delete your account?</p>
              <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">This can&apos;t be undone.</p>
            </div>
            <button onClick={onClose} className="p-1.5 text-[var(--text-muted)]" aria-label="Close"><X size={20} /></button>
          </div>

          <ul className="mt-4 space-y-2 text-[13.5px] text-[var(--text-secondary)] list-disc pl-5">
            <li><b className="text-[var(--text-primary)]">Erased:</b> your name, email, Google link, photo, UPI ID, AI key, personal expenses and notifications.</li>
            <li><b className="text-[var(--text-primary)]">Groups where you&apos;re settled up:</b> you leave them.</li>
            <li><b className="text-[var(--text-primary)]">Groups where money is still open:</b> the bills stay so everyone else&apos;s balances still add up, shown as &quot;Deleted user&quot;. Settle up first if you can.</li>
            <li>You can sign up again later with the same Google account, as a new person.</li>
          </ul>
          <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">Want a copy first? Use <b>Download my data</b> before deleting.</p>

          <label className="block mt-4 text-[13px] font-semibold text-[var(--text-primary)]" htmlFor="confirm-delete">
            Type DELETE to confirm
          </label>
          <input
            id="confirm-delete"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            className="mt-1.5 w-full px-4 py-3 rounded-[14px] bg-[var(--paper-dim)] text-[15px] font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-[#F43F5E]/40"
          />
          {error && <p role="alert" className="mt-2 text-[13px] font-medium text-[var(--negative)]">{error}</p>}
        </div>

        <div className="px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] border-t border-[var(--hairline)] flex gap-3">
          <button onClick={onClose} className="px-5 py-3.5 rounded-[16px] bg-[var(--paper-dim)] font-bold text-[15px] text-[var(--text-secondary)]">Cancel</button>
          <button
            onClick={remove}
            disabled={typed.trim().toUpperCase() !== "DELETE" || busy}
            className="flex-1 py-3.5 rounded-[16px] bg-[#E11D48] text-white font-bold text-[15px] disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={16} className="animate-spin" />} Delete my account
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
