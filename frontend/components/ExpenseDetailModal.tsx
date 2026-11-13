import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Trash2, Repeat, Pencil, ChevronLeft, ChevronRight, Lock, Eye, ReceiptText, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { AvatarById, usePeople } from "@/components/ui/MemberAvatar";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";
import { groupKey } from "@/lib/queries";
import { FEE_POLICY_TEXT, myPart, readBill, type Bill, type BillItem } from "@/lib/billDetails";
import { useBackClose } from "@/lib/backClose";

interface ExpenseDetailModalProps {
  expense: any;
  groupId?: string;
  currentUserId?: string;
  isAdmin?: boolean;
  onClose: () => void;
  onDelete?: (id: string) => void;
  /** Start a new expense pre-filled from this one (description + amount) */
  onRepeat?: (expense: any) => void;
  /** Change this expense in place (creator or group admin) */
  onEdit?: (expense: any) => void;
  isDeleting?: boolean;
}

const money = (n: number) => `₹${n.toFixed(2)}`;
const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const PLATFORM: Record<string, string> = {
  blinkit: "Blinkit", zepto: "Zepto", instamart: "Instamart", swiggy: "Swiggy", zomato: "Zomato",
  bigbasket: "BigBasket", amazon: "Amazon", flipkart: "Flipkart",
};

/**
 * One expense. The first thing shown is what it means for you (your share, what you
 * paid, what you get back), then who paid and who owes. Imported orders keep their item
 * list: "See items" opens it in two modes — the items you're in, and the full bill.
 * An item only one person had is private: others see "Private item" and its price until
 * its owner chooses to show it.
 */
export function ExpenseDetailModal({
  expense, groupId, currentUserId, isAdmin, onClose, onDelete, onRepeat, onEdit, isDeleting,
}: ExpenseDetailModalProps) {
  useBackClose(onClose);
  const modalRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"summary" | "items">("summary");

  // Close on Escape or outside click
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      // a confirm on top of this (e.g. "Delete this expense?") isn't an outside click
      if ((e.target as Element | null)?.closest?.("[data-app-dialog]")) return;
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  const bill = useMemo(() => readBill(expense?.receiptData), [expense?.receiptData]);
  if (!expense) return null;

  const me = currentUserId ?? "";
  const canDelete = expense.createdBy?.id === currentUserId || !!isAdmin;
  const myShare = num(expense.splits?.find((s: any) => s.userId === me)?.shareAmount);
  const myPaid = num(expense.payers?.find((p: any) => p.userId === me)?.amountPaid);
  const inBill = !!bill?.items.some((i) => i.sharedBy.includes(me));

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={modalRef}
        className="w-full sm:max-w-lg bg-[var(--paper)] sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-10 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
        style={{ maxHeight: "90vh", minHeight: view === "items" ? "70vh" : undefined }}
      >
        {/* Header */}
        <div className="px-3 py-3 border-b border-[var(--hairline)] flex items-center gap-1 bg-[var(--paper)] sticky top-0 z-10">
          {view === "items" ? (
            <button onClick={() => setView("summary")} className="p-2 rounded-full hover:bg-[var(--paper-dim)] text-[var(--text-secondary)]" aria-label="Back">
              <ChevronLeft size={22} />
            </button>
          ) : <span className="w-2" />}
          <h2 className="flex-1 text-lg font-bold text-[var(--text-primary)] tracking-tight">
            {view === "items" ? "Bill items" : "Expense details"}
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[var(--paper-dim)] text-[var(--text-muted)]" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto bg-[var(--paper-dim)] flex-1 space-y-5">
          {view === "summary" ? (
            <>
              {/* What it is */}
              <div className="flex items-start gap-3 bg-[var(--paper)] p-4 rounded-2xl border border-[var(--hairline)]">
                <div className="mt-0.5 flex-shrink-0"><CategoryIcon category={expense.category} /></div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[18px] font-bold text-[var(--text-primary)] leading-snug">{expense.description}</h3>
                  <p className="text-[13px] font-medium text-[var(--text-secondary)] mt-0.5">
                    {new Date(expense.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {bill?.platform && (
                      <span className="px-2 py-0.5 rounded-md bg-[var(--accent-subtle)] text-[11px] font-bold text-[var(--accent)]">
                        {PLATFORM[bill.platform] ?? bill.platform}{bill.orderId ? ` · #${bill.orderId}` : ""}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-md bg-[var(--paper-dim)] text-[11px] font-semibold text-[var(--text-secondary)]">
                      {`Added by ${expense.createdBy?.id === me ? "you" : expense.createdBy?.name || "someone"}${expense.editedAt ? " · edited " + new Date(expense.editedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}`}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Total</p>
                  <p className="text-[20px] font-black text-[var(--text-primary)] tabular-nums">{money(num(expense.amount))}</p>
                </div>
              </div>

              {/* What it means for you — the first thing to read */}
              <YourPart expense={expense} me={me} myShare={myShare} myPaid={myPaid} bill={bill} inBill={inBill} onSeeItems={() => setView("items")} />

              {/* Paid by */}
              <Section title="Paid by">
                {expense.payers?.map((p: any) => (
                  <PersonRow key={p.userId} id={p.userId} name={p.name} you={p.userId === me} amount={num(p.amountPaid)} />
                ))}
              </Section>

              {/* Who owes what */}
              <Section title="Split">
                {expense.splits?.map((s: any) => (
                  <PersonRow key={s.userId} id={s.userId} name={s.name} you={s.userId === me} amount={num(s.shareAmount)} />
                ))}
              </Section>

              {/* Older expenses typed in by hand with specific items */}
              {Array.isArray(expense.receiptData) && expense.receiptData.length > 0 && (
                <Section title="Specific items">
                  {expense.receiptData.map((item: any) => (
                    <div key={item.id} className="p-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--text-primary)] truncate">{item.label}</div>
                        <div className="flex -space-x-1 mt-1">
                          {item.sharedBy?.map((uid: string) => <AvatarById key={uid} id={uid} name={nameFrom(expense, uid)} size={18} />)}
                        </div>
                      </div>
                      <span className="font-bold text-[var(--text-primary)] tabular-nums">{money(num(item.amount))}</span>
                    </div>
                  ))}
                </Section>
              )}
            </>
          ) : bill ? (
            <BillItems expense={expense} bill={bill} me={me} myShare={myShare} inBill={inBill} groupId={groupId} />
          ) : null}
        </div>

        {/* Footer actions */}
        {view === "summary" && ((canDelete && onDelete) || onRepeat || (canDelete && onEdit)) && (
          <div className="px-4 py-3 bg-[var(--paper)] border-t border-[var(--hairline)] flex gap-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            {canDelete && onEdit && (
              <button onClick={() => onEdit(expense)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[var(--text-primary)] bg-[var(--paper-dim)]">
                <Pencil size={18} /> Edit
              </button>
            )}
            {onRepeat && (
              <button onClick={() => onRepeat(expense)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[var(--accent)] bg-[var(--accent-subtle)]">
                <Repeat size={18} /> Repeat
              </button>
            )}
            {canDelete && onDelete && (
              <button
                onClick={() => onDelete(expense.id)}
                disabled={isDeleting}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-red-500 bg-red-50 hover:bg-red-100 disabled:opacity-50"
              >
                {isDeleting ? <div className="spinner-sm border-red-500" /> : <Trash2 size={18} />}
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function nameFrom(expense: any, uid: string): string {
  return (
    expense.splits?.find((s: any) => s.userId === uid)?.name ??
    expense.payers?.find((p: any) => p.userId === uid)?.name ??
    "Someone"
  );
}
const first = (n: string) => n.trim().split(/\s+/)[0] || n;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 ml-1">{title}</h4>
      <div className="bg-[var(--paper)] rounded-2xl border border-[var(--hairline)] divide-y divide-[var(--hairline)] overflow-hidden">{children}</div>
    </div>
  );
}

function PersonRow({ id, name, you, amount }: { id: string; name: string; you: boolean; amount: number }) {
  return (
    <div className="p-3.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <AvatarById id={id} name={name} size={32} />
        <span className="font-semibold text-[var(--text-primary)] truncate">{name}{you && " (You)"}</span>
      </div>
      <span className="font-bold text-[var(--text-primary)] tabular-nums">{money(amount)}</span>
    </div>
  );
}

/** Your share, what you paid, and what that leaves — plus the way into the item list. */
function YourPart({
  expense, me, myShare, myPaid, bill, inBill, onSeeItems,
}: { expense: any; me: string; myShare: number; myPaid: number; bill: Bill | null; inBill: boolean; onSeeItems: () => void }) {
  const net = Math.round((myPaid - myShare) * 100) / 100;
  const payers = (expense.payers ?? []) as { userId: string; name: string }[];
  const otherPayer = payers.length === 1 && payers[0].userId !== me ? first(payers[0].name) : null;
  const involved = myShare > 0 || myPaid > 0;
  const part = bill && inBill ? myPart(bill, me, myShare) : null;

  let line: string;
  if (!involved) line = "You're not part of this one";
  else if (net > 0.004) line = `You paid ${money(myPaid)} · you get back ${money(net)}`;
  else if (net < -0.004) line = otherPayer ? `You owe ${otherPayer} ${money(-net)}` : `You owe ${money(-net)}`;
  else line = "You paid exactly your share";

  return (
    <div className="rounded-2xl bg-[var(--accent-subtle)] border border-[var(--hairline)] overflow-hidden">
      <div className="p-4">
        <p className="text-[11px] font-bold text-[var(--accent)] uppercase tracking-wider">Your share</p>
        <p className="text-[28px] font-black text-[var(--text-primary)] tabular-nums leading-tight">{money(myShare)}</p>
        <p className={`text-[14px] font-semibold mt-0.5 ${net > 0.004 ? "text-[var(--positive)]" : net < -0.004 ? "text-[var(--negative)]" : "text-[var(--text-secondary)]"}`}>{line}</p>
        {part && (
          <p className="text-[12px] text-[var(--text-secondary)] mt-1">
            {part.items.length} {part.items.length === 1 ? "item" : "items"} {money(part.itemsTotal)}
            {Math.abs(part.extras) >= 0.01 && ` ${part.extras > 0 ? "+" : "−"} ${money(Math.abs(part.extras))} fees & discounts`}
          </p>
        )}
      </div>
      {bill && (
        <button onClick={onSeeItems} className="w-full px-4 py-3 flex items-center gap-2 bg-[var(--paper)] border-t border-[var(--hairline)] text-left">
          <ReceiptText size={18} className="text-[var(--accent)]" />
          <span className="flex-1 text-[14px] font-bold text-[var(--text-primary)]">
            See items <span className="font-medium text-[var(--text-secondary)]">· {bill.items.length} on the bill</span>
          </span>
          <ChevronRight size={18} className="text-[var(--text-muted)]" />
        </button>
      )}
    </div>
  );
}

/** The saved item list in two modes: the items you're in, and the whole bill. */
function BillItems({
  expense, bill, me, myShare, inBill, groupId,
}: { expense: any; bill: Bill; me: string; myShare: number; inBill: boolean; groupId?: string }) {
  const [mode, setMode] = useState<"mine" | "all">(inBill ? "mine" : "all");
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { authFetch } = useAuth();
  const queryClient = useQueryClient();
  const people = usePeople();
  const name = (uid: string) => (uid === me ? "you" : first(people[uid]?.name ?? nameFrom(expense, uid)));
  const iAdded = expense.createdBy?.id === me;

  const mineSolo = bill.items.filter((i) => i.owner === me);
  const hiddenMine = mineSolo.filter((i) => !i.visible);
  const maskedCount = bill.items.filter((i) => i.masked).length;
  const part = myPart(bill, me, myShare);

  async function setVisible(items: BillItem[], visible: boolean, key: number | "all") {
    if (!groupId || items.length === 0) return;
    setBusy(key);
    setError(null);
    try {
      await readJson(
        await authFetch(`/expenses/${expense.id}/item-visibility`, {
          method: "PATCH",
          body: JSON.stringify({ items: items.map((i) => i.index), visible }),
        })
      );
      await queryClient.invalidateQueries({ queryKey: groupKey(groupId) });
    } catch (err) {
      setError((err as Error).message || "Couldn't change that. Check your connection.");
    } finally {
      setBusy(null);
    }
  }

  const privacy = (it: BillItem) => {
    if (it.owner !== me) {
      // Someone else's private item that you can read (you added the bill): say others can't.
      return it.owner && !it.masked && !it.visible && iAdded ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--text-muted)]"><Lock size={11} /> Hidden from others</span>
      ) : null;
    }
    return (
      <button
        onClick={() => setVisible([it], !it.visible, it.index)}
        disabled={busy !== null || !groupId}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
          it.visible ? "border-[var(--hairline)] text-[var(--text-secondary)]" : "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-subtle)]"
        }`}
        aria-label={it.visible ? "Visible to the group. Tap to hide" : "Private. Tap to show the group"}
      >
        {busy === it.index ? <Loader2 size={11} className="animate-spin" /> : it.visible ? <Eye size={11} /> : <Lock size={11} />}
        {it.visible ? "Shown to group" : "Private"}
      </button>
    );
  };

  const itemTitle = (it: BillItem) =>
    it.masked ? (
      <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] italic"><Lock size={13} /> Private item</span>
    ) : (
      <>
        {it.qty && it.qty > 1 ? <span className="text-[var(--text-secondary)]">{it.qty} × </span> : null}
        {it.name || "Item"}
        {it.variant && <span className="text-[12px] font-medium text-[var(--text-muted)]"> · {it.variant}</span>}
      </>
    );

  return (
    <div className="space-y-4">
      {/* Mode switch */}
      <div className="grid grid-cols-2 p-1 rounded-xl bg-[var(--paper)] border border-[var(--hairline)]" role="tablist">
        {([["mine", "Your items"], ["all", "Full bill"]] as const).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={`py-2 rounded-lg text-[14px] font-bold ${mode === k ? "bg-[var(--accent)] text-white" : "text-[var(--text-secondary)]"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Your private items: who can see them */}
      {mineSolo.length > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-[var(--paper)] border border-[var(--hairline)]">
          {hiddenMine.length > 0 ? <Lock size={18} className="text-[var(--accent)] flex-shrink-0" /> : <Eye size={18} className="text-[var(--text-secondary)] flex-shrink-0" />}
          <p className="flex-1 text-[12px] leading-snug text-[var(--text-secondary)]">
            {hiddenMine.length > 0
              ? `${hiddenMine.length} of your items ${hiddenMine.length === 1 ? "is" : "are"} private. Others see "Private item" and the price only.`
              : "All your items are visible to the group."}
          </p>
          <button
            onClick={() => (hiddenMine.length > 0 ? setVisible(hiddenMine, true, "all") : setVisible(mineSolo, false, "all"))}
            disabled={busy !== null || !groupId}
            className="px-3 py-1.5 rounded-full text-[12px] font-bold bg-[var(--paper-dim)] text-[var(--text-primary)] flex items-center gap-1 flex-shrink-0"
          >
            {busy === "all" && <Loader2 size={12} className="animate-spin" />}
            {hiddenMine.length > 0 ? "Show all" : "Hide all"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-[13px] font-medium text-[var(--negative)] px-1">{error}</p>}
      {expense.receiptData?.editedByHand && (
        <p className="text-[12px] text-[var(--text-muted)] px-1">The split was changed by hand after this order was imported, so the shares may not follow the items exactly.</p>
      )}

      {mode === "mine" ? (
        part.items.length === 0 ? (
          <div className="p-6 text-center rounded-2xl bg-[var(--paper)] border border-[var(--hairline)] text-[14px] text-[var(--text-secondary)]">
            None of the items on this bill are yours.
          </div>
        ) : (
          <Section title={`You're in ${part.items.length} ${part.items.length === 1 ? "item" : "items"}`}>
            {part.items.map((it) => {
              const others = it.sharedBy.filter((u) => u !== me);
              return (
                <div key={it.index} className="p-3.5 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[15px] text-[var(--text-primary)] leading-snug">{itemTitle(it)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--text-secondary)]">
                      {others.length === 0 ? <span>Only you</span> : <span>Split {it.sharedBy.length} ways · with {others.map(name).join(", ")}</span>}
                      {privacy(it)}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-[var(--text-primary)] tabular-nums">{money(it.mine)}</div>
                    {others.length > 0 && <div className="text-[11px] text-[var(--text-muted)] tabular-nums">of {money(it.lineTotal)}</div>}
                  </div>
                </div>
              );
            })}
            {Math.abs(part.extras) >= 0.01 && (
              <div className="p-3.5 flex justify-between gap-3 text-[14px]">
                <span className="text-[var(--text-secondary)]">Your part of fees & discounts</span>
                <span className="font-semibold tabular-nums">{part.extras > 0 ? "+" : "−"}{money(Math.abs(part.extras))}</span>
              </div>
            )}
            <div className="p-3.5 flex justify-between gap-3 bg-[var(--paper-dim)]">
              <span className="font-bold">Your share</span>
              <span className="font-black tabular-nums">{money(part.share)}</span>
            </div>
          </Section>
        )
      ) : (
        <>
          <Section title={`${bill.items.length} items`}>
            {bill.items.map((it) => (
              <div key={it.index} className="p-3.5 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[15px] text-[var(--text-primary)] leading-snug">{itemTitle(it)}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--text-secondary)]">
                    <span className="flex -space-x-1">
                      {it.sharedBy.slice(0, 5).map((u, i) => (
                        <span key={u} className="relative flex rounded-full ring-2 ring-[var(--paper)]" style={{ zIndex: 5 - i }}>
                          <AvatarById id={u} name={people[u]?.name ?? nameFrom(expense, u)} size={18} />
                        </span>
                      ))}
                    </span>
                    <span>
                      {it.sharedBy.length === 0
                        ? "Nobody"
                        : it.owner
                        ? `Only ${name(it.owner)}`
                        : `${money(Math.round((it.lineTotal / it.sharedBy.length) * 100) / 100)} each · ${it.sharedBy.length} people`}
                    </span>
                    {privacy(it)}
                  </div>
                </div>
                <span className={`font-bold tabular-nums flex-shrink-0 ${it.sharedBy.includes(me) ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                  {money(it.lineTotal)}
                </span>
              </div>
            ))}
            <div className="p-3.5 flex justify-between text-[14px]">
              <span className="text-[var(--text-secondary)]">Items total</span>
              <span className="font-semibold tabular-nums">{money(bill.itemsTotal)}</span>
            </div>
          </Section>

          {(bill.fees.length > 0 || bill.discounts.length > 0) && (
            <Section title="Fees & discounts">
              {bill.fees.map((f, i) => (
                <div key={`f${i}`} className="p-3.5 flex justify-between text-[14px]">
                  <span className="text-[var(--text-secondary)]">{f.label}</span>
                  <span className="font-semibold tabular-nums">{money(f.amount)}</span>
                </div>
              ))}
              {bill.discounts.map((d, i) => (
                <div key={`d${i}`} className="p-3.5 flex justify-between text-[14px]">
                  <span className="text-[var(--text-secondary)]">{d.label || "Discount"}</span>
                  <span className="font-semibold tabular-nums text-[var(--positive)]">−{money(d.amount)}</span>
                </div>
              ))}
              <div className="px-3.5 py-2.5 text-[12px] text-[var(--text-muted)]">{FEE_POLICY_TEXT[bill.feePolicy]}</div>
            </Section>
          )}

          <div className="p-4 rounded-2xl bg-[var(--paper)] border border-[var(--hairline)] flex justify-between items-center">
            <span className="font-bold">Bill total</span>
            <span className="text-[18px] font-black tabular-nums">{money(num(expense.amount))}</span>
          </div>

          {maskedCount > 0 && (
            <p className="text-[12px] text-[var(--text-muted)] px-1 flex items-start gap-1.5">
              <Lock size={13} className="mt-0.5 flex-shrink-0" />
              {maskedCount} {maskedCount === 1 ? "item is" : "items are"} private. Only the person who had {maskedCount === 1 ? "it" : "them"} can show what {maskedCount === 1 ? "it was" : "they were"}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
