"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { closeDialog, dialogStore, dismissToast, type DialogItem, type Tone } from "@/lib/dialog";
import { useBackClose } from "@/lib/backClose";

const TOAST_ICON: Record<Tone, { Icon: typeof Info; color: string }> = {
  success: { Icon: CheckCircle2, color: "var(--positive)" },
  error: { Icon: XCircle, color: "var(--negative)" },
  info: { Icon: Info, color: "var(--accent)" },
};

/** Draws toasts and dialogs from lib/dialog.ts. Mounted once, in Providers. */
export default function AppDialogs() {
  const { toasts, dialogs } = useSyncExternalStore(dialogStore.subscribe, dialogStore.get, dialogStore.server);
  const isClient = useSyncExternalStore(dialogStore.subscribe, () => true, () => false);
  if (!isClient) return null;
  const top = dialogs[0];

  return createPortal(
    <>
      {/* Toasts: top of the screen, under the status bar */}
      <div className="fixed inset-x-0 top-0 z-[400] flex flex-col items-center gap-2 px-4 pt-[max(12px,env(safe-area-inset-top))] pointer-events-none" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const { Icon, color } = TOAST_ICON[t.tone];
            return (
              <motion.button
                key={t.id}
                layout
                initial={{ y: -24, opacity: 0, scale: 0.96 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -16, opacity: 0, scale: 0.96 }}
                transition={{ type: "spring", bounce: 0.25, duration: 0.4 }}
                onClick={() => dismissToast(t.id)}
                role={t.tone === "error" ? "alert" : "status"}
                className="pointer-events-auto w-full max-w-sm flex items-center gap-3 px-4 py-3 rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] shadow-[0_12px_32px_-8px_rgba(0,0,0,0.28)] text-left"
              >
                <Icon size={20} style={{ color }} className="flex-shrink-0" />
                <span className="text-[14px] font-semibold text-[var(--text-primary)] leading-snug">{t.text}</span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      {/* One dialog at a time; the next one waits its turn */}
      <AnimatePresence>{top && <Dialog key={top.id} d={top} />}</AnimatePresence>
    </>,
    document.body
  );
}

function Dialog({ d }: { d: DialogItem }) {
  const cancel = () => closeDialog(d.id, false);
  useBackClose(cancel);
  const mainRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { mainRef.current?.focus({ preventScroll: true }); }, []);

  const tone = d.tone ?? "default";
  const icon =
    tone === "danger" ? { Icon: AlertTriangle, color: "var(--negative)" }
    : tone === "error" ? { Icon: XCircle, color: "var(--negative)" }
    : tone === "success" ? { Icon: CheckCircle2, color: "var(--positive)" }
    : null;
  const oneButton = d.cancelLabel == null;

  return (
    <motion.div
      data-app-dialog
      className="fixed inset-0 z-[300] flex items-end justify-center bg-black/45"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={cancel}
      onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
    >
      <motion.div
        role={oneButton ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={`dlg-${d.id}`}
        initial={{ y: 48 }}
        animate={{ y: 0 }}
        exit={{ y: 48 }}
        transition={{ type: "spring", bounce: 0.18, duration: 0.38 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--paper)] rounded-t-[28px] px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--hairline)]" aria-hidden />
        <div className="flex items-start gap-3.5">
          {icon && (
            <span className="w-11 h-11 rounded-[14px] flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${icon.color} 14%, transparent)`, color: icon.color }}>
              <icon.Icon size={22} strokeWidth={2.3} />
            </span>
          )}
          <div className="flex-1 min-w-0 pt-0.5">
            <p id={`dlg-${d.id}`} className="font-extrabold text-[18px] leading-snug text-[var(--text-primary)]">{d.title}</p>
            {d.body && <div className="mt-1.5 text-[14px] text-[var(--text-secondary)] leading-relaxed">{d.body}</div>}
          </div>
        </div>
        <div className={`mt-6 grid gap-2.5 ${oneButton ? "grid-cols-1" : "grid-cols-2"}`}>
          {!oneButton && (
            <button onClick={cancel} className="py-3.5 rounded-[16px] bg-[var(--paper-dim)] font-bold text-[15px] text-[var(--text-secondary)] active:scale-[0.98] transition-transform">
              {d.cancelLabel}
            </button>
          )}
          <button
            ref={mainRef}
            onClick={() => closeDialog(d.id, true)}
            className={`py-3.5 rounded-[16px] font-bold text-[15px] text-white active:scale-[0.98] transition-transform ${tone === "danger" ? "bg-[var(--negative)]" : "bg-[var(--accent)]"}`}
          >
            {d.confirmLabel ?? "OK"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
