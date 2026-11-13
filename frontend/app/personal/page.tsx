"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { SpendingView } from "@/components/spending/SpendingView";
import EntrySheet, { draftFrom, type EntryDraft } from "@/components/spending/EntrySheet";
import BudgetSheet from "@/components/spending/BudgetSheet";
import GroupChat from "@/components/GroupChat";
import { useQueryClient } from "@tanstack/react-query";
import { dayStart, type QuickEntry } from "@/lib/quickAdd";
import { inr, useSpending, useSpendingActions, type SpendEntry } from "@/lib/spending";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";
import { fileToCompressedDataUrl } from "@/lib/image";
import { guessCategory, CATEGORIES, type Category } from "@/lib/quickAdd";
import { PLATFORM_LABEL, type ExtractResponse } from "@/lib/orderImport";
import { Camera, ImagePlus, X } from "lucide-react";

const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);

interface Toast { text: string; undo?: () => Promise<unknown> }

/**
 * Spending: what you spent this month (your own + your share of group bills), with a
 * two-second quick add. See PERSONAL_SPENDING_PLAN.md.
 */
export default function SpendingPageWrapper() {
  // useSearchParams needs a Suspense boundary on this (otherwise static) page.
  return (
    <Suspense fallback={null}>
      <SpendingPage />
    </Suspense>
  );
}

function SpendingPage() {
  const authed = useRequireAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [month, setMonth] = useState(thisMonth);
  const { data } = useSpending(month);
  const actions = useSpendingActions();
  // /personal?add=1 (old "Add Log" links) opens the sheet straight away.
  const [sheet, setSheet] = useState<{ mode: "add"; prefill?: Partial<EntryDraft> } | { mode: "edit"; entry: SpendEntry } | null>(() =>
    params?.get("add") ? { mode: "add" } : null
  );
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const queryClient = useQueryClient();
  const [quickBusy, setQuickBusy] = useState(false);
  const { authFetch } = useAuth();
  const [scanning, setScanning] = useState(false);
  // Home → Scan bill → "Just me" lands here: ask how (opening the camera needs a tap).
  const [scanAsk, setScanAsk] = useState(() => !!params?.get("scan"));
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  /** Read a bill / receipt / payment picture and open the add sheet filled in. */
  async function scan(file: File | undefined) {
    if (!file) return;
    setScanAsk(false);
    setScanning(true);
    show({ text: "Reading the bill…" });
    try {
      const imageBase64 = await fileToCompressedDataUrl(file, 2000, 0.85);
      const res = await authFetch("/ai/extract-order", { method: "POST", body: JSON.stringify({ imageBase64 }) });
      const data = await readJson<ExtractResponse & { fallback?: boolean; message?: string }>(res);
      if (data.fallback || !data.order) throw new Error(data.message || "Couldn't read that picture");
      const o = data.order;
      const amount = o.grandTotal ?? o.itemTotal ?? o.items.reduce((a, i) => a + i.lineTotal, 0);
      const name = o.merchant || o.payee || (o.platform !== "other" ? `${PLATFORM_LABEL[o.platform]} order` : o.items[0]?.name) || "";
      const cat = (CATEGORIES as readonly string[]).includes(o.category ?? "") ? (o.category as Category) : guessCategory(name);
      setToast(null);
      setSheet({
        mode: "add",
        prefill: { description: name, amount: amount ? String(amount) : "", category: cat, ...(o.orderDate ? { day: o.orderDate } : {}) },
      });
    } catch (err) {
      show({ text: (err as Error).message || "Couldn't read that picture. Try a clearer one or add it by hand." });
    } finally {
      setScanning(false);
      if (params?.get("scan")) router.replace("/personal");
    }
  }
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((t: Toast) => {
    setToast(t);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  async function quickAdd(e: QuickEntry): Promise<boolean> {
    setQuickBusy(true);
    try {
      const created = await actions.add({ description: e.description, amount: e.amount, category: e.category, spentAt: dayStart(e.daysAgo).toISOString() });
      show({ text: `Added ${e.description} · ${inr(e.amount)}`, undo: () => actions.remove(created.id) });
      return true;
    } catch (err) {
      show({ text: (err as Error).message || "Couldn't add it. Check your connection." });
      return false;
    } finally {
      setQuickBusy(false);
    }
  }

  if (!authed) return null;

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb max-w-md mx-auto">
        <header className="px-5 pt-14 pb-4 flex items-end justify-between">
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-secondary)]">Personal</p>
            <h1 className="text-[28px] font-bold tracking-tight leading-tight">Your spending</h1>
          </div>
          <button onClick={() => setAskOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[var(--paper)] border border-[var(--hairline)] text-[13px] font-bold">
            <Sparkles size={15} className="text-[var(--accent)]" /> Ask
          </button>
        </header>

        <div className="px-5 pb-10">
          <SpendingView
            o={data}
            month={month}
            onMonth={setMonth}
            onQuickAdd={quickAdd}
            onOpenAdd={(prefill) => setSheet({ mode: "add", prefill: prefill as Partial<EntryDraft> })}
            onEdit={(entry) => setSheet({ mode: "edit", entry })}
            onBudget={() => setBudgetOpen(true)}
            onAsk={() => setAskOpen(true)}
            onScan={() => setScanAsk(true)}
            scanning={scanning}
            quickBusy={quickBusy}
          />
        </div>
      </main>

      {sheet && (
        <EntrySheet
          initial={sheet.mode === "edit" ? draftFrom(sheet.entry) : sheet.prefill}
          onClose={() => { setSheet(null); if (params?.get("add")) router.replace("/personal"); }}
          onSave={async (d) => {
            if (sheet.mode === "edit") {
              await actions.update(sheet.entry.id, d);
              show({ text: "Saved" });
            } else {
              const created = await actions.add(d);
              show({ text: `Added ${d.description} · ${inr(d.amount)}`, undo: () => actions.remove(created.id) });
            }
            setSheet(null);
          }}
          onDelete={
            sheet.mode === "edit"
              ? async () => {
                  const id = sheet.entry.id;
                  await actions.remove(id);
                  setSheet(null);
                  show({ text: `Deleted ${sheet.entry.description}`, undo: () => actions.restore(id) });
                }
              : undefined
          }
        />
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void scan(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void scan(e.target.files?.[0]); e.target.value = ""; }} />
      {scanAsk && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40" onClick={() => { setScanAsk(false); if (params?.get("scan")) router.replace("/personal"); }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Scan a bill" className="w-full max-w-md bg-[var(--paper)] rounded-t-[28px] p-5 pb-[max(20px,env(safe-area-inset-bottom))]">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-[17px]">Scan a bill</p>
                <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">A receipt, order, UPI payment, ride or ticket. You check it before it&apos;s saved.</p>
              </div>
              <button onClick={() => setScanAsk(false)} className="p-1.5 -mr-1.5 text-[var(--text-muted)]" aria-label="Close"><X size={20} /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button onClick={() => cameraRef.current?.click()} className="py-4 rounded-[16px] bg-[var(--accent)] text-white font-bold text-[15px] flex items-center justify-center gap-2"><Camera size={19} /> Take photo</button>
              <button onClick={() => galleryRef.current?.click()} className="py-4 rounded-[16px] bg-[var(--paper-dim)] font-bold text-[15px] flex items-center justify-center gap-2"><ImagePlus size={19} /> From gallery</button>
            </div>
          </div>
        </div>
      )}

      {askOpen && (
        <GroupChat
          personal
          groupId="personal"
          groupName="your spending"
          onClose={() => setAskOpen(false)}
          onLogged={() => queryClient.invalidateQueries({ queryKey: ["spending"] })}
        />
      )}

      {budgetOpen && (
        <BudgetSheet
          current={data?.budget ?? null}
          lastMonth={data?.prevTotal ?? 0}
          onClose={() => setBudgetOpen(false)}
          onSave={async (amount) => {
            await actions.setBudget(amount);
            setBudgetOpen(false);
            show({ text: amount ? `Budget set to ${inr(amount)} a month` : "Budget removed" });
          }}
        />
      )}

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="fixed left-1/2 -translate-x-1/2 bottom-[88px] z-[95] w-[calc(100%-32px)] max-w-sm flex items-center gap-3 px-4 py-3 rounded-[16px] bg-[#16181D] text-white shadow-xl"
            role="status"
          >
            <span className="flex-1 text-[14px] font-medium truncate">{toast.text}</span>
            {toast.undo && (
              <button
                onClick={async () => { const u = toast.undo!; setToast(null); await u().catch(() => {}); }}
                className="text-[14px] font-bold text-[#FCD34D]"
              >
                Undo
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <BottomNav />
    </>
  );
}

