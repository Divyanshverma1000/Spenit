"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { SpendingView } from "@/components/spending/SpendingView";
import EntrySheet, { draftFrom, type EntryDraft } from "@/components/spending/EntrySheet";
import BudgetSheet from "@/components/spending/BudgetSheet";
import { dayStart, type QuickEntry } from "@/lib/quickAdd";
import { inr, useSpending, useSpendingActions, type SpendEntry } from "@/lib/spending";

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
  const [quickBusy, setQuickBusy] = useState(false);
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
          <Link href="/personal/chat" className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-[var(--paper)] border border-[var(--hairline)] text-[13px] font-bold">
            <Sparkles size={15} className="text-[var(--accent)]" /> Ask
          </Link>
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

