import React, { useEffect, useRef } from "react";
import { X, Trash2, Repeat, Pencil } from "lucide-react";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { AvatarById } from "@/components/ui/MemberAvatar";

interface ExpenseDetailModalProps {
  expense: any;
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

export function ExpenseDetailModal({
  expense,
  currentUserId,
  isAdmin,
  onClose,
  onDelete,
  onRepeat,
  onEdit,
  isDeleting,
}: ExpenseDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape or outside click
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  if (!expense) return null;

  const canDelete = expense.createdBy?.id === currentUserId || !!isAdmin;

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={modalRef}
        className="w-full sm:max-w-lg bg-[var(--ink)] sm:rounded-2xl rounded-t-2xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-10 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between bg-white sticky top-0 z-10">
          <h2 className="text-lg font-bold text-gray-900 tracking-tight">Expense Details</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 overflow-y-auto bg-gray-50 flex-1 space-y-6">
          
          {/* Main Info */}
          <div className="flex items-start gap-4 bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className="mt-1 flex-shrink-0">
              <CategoryIcon category={expense.category} />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-gray-900">{expense.description}</h3>
              <p className="text-sm font-medium text-gray-500 mt-1">
                {new Date(expense.createdAt).toLocaleDateString("en-IN", {
                  day: "numeric", month: "short", year: "numeric",
                  hour: "2-digit", minute: "2-digit"
                })}
              </p>
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-md text-xs font-semibold text-gray-600">
                {`Added by ${expense.createdBy?.name || "Someone"}${expense.editedAt ? " · edited " + new Date(expense.editedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}`}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Total</p>
              <p className="text-2xl font-black text-gray-900 tabular-nums">
                ₹{parseFloat(expense.amount).toFixed(2)}
              </p>
            </div>
          </div>

          {/* Paid By */}
          <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 ml-2">Paid By</h4>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
              {expense.payers?.map((p: any) => (
                <div key={p.userId} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AvatarById id={p.userId} name={p.name} size={32} />
                    <span className="font-semibold text-gray-900">{p.name} {p.userId === currentUserId && "(You)"}</span>
                  </div>
                  <span className="font-bold text-gray-900 tabular-nums">₹{parseFloat(p.amountPaid).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Receipt Data (Specific Items) */}
          {expense.receiptData && expense.receiptData.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 ml-2">Specific Items (Receipt)</h4>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
                {expense.receiptData.map((item: any) => (
                  <div key={item.id} className="p-4 flex flex-col gap-2">
                    <div className="flex items-start justify-between">
                      <span className="font-semibold text-gray-900">{item.label}</span>
                      <span className="font-bold text-gray-900 tabular-nums">₹{parseFloat(item.amount).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Shared By:</span>
                      <div className="flex gap-1">
                        {item.sharedBy?.map((uid: string) => {
                          const person = expense.splits?.find((s: any) => s.userId === uid) || expense.payers?.find((p: any) => p.userId === uid);
                          return <AvatarById key={uid} id={uid} name={person?.name ?? "?"} size={20} />;
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Final Exact Splits */}
          <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 ml-2">Final Splits</h4>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
              {expense.splits?.map((s: any) => (
                <div key={s.userId} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AvatarById id={s.userId} name={s.name} size={32} />
                    <span className="font-semibold text-gray-900">{s.name} {s.userId === currentUserId && "(You)"}</span>
                  </div>
                  <span className="font-bold text-gray-900 tabular-nums">₹{parseFloat(s.shareAmount).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
          
        </div>

        {/* Footer actions */}
        {((canDelete && onDelete) || onRepeat || (canDelete && onEdit)) && (
          <div className="px-5 py-4 bg-white border-t border-[var(--border)] flex gap-3">
            {canDelete && onEdit && (
              <button
                onClick={() => onEdit(expense)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[var(--text-primary)] bg-[var(--paper-dim)] transition-colors"
              >
                <Pencil size={18} />
                Edit
              </button>
            )}
            {onRepeat && (
              <button
                onClick={() => onRepeat(expense)}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[var(--accent)] bg-[var(--accent-subtle)] transition-colors"
              >
                <Repeat size={18} />
                Repeat
              </button>
            )}
            {canDelete && onDelete && (
              <button
                onClick={() => onDelete(expense.id)}
                disabled={isDeleting}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-red-500 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
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
