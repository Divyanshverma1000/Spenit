"use client";

import { Fragment, useMemo, useState } from "react";
import {
  ArrowRight, ArrowRightLeft, CheckCircle2, Loader2, LogOut, Pencil, PlusCircle, RotateCcw, Trash2, UserCheck, UserMinus, UserPlus, Undo2, XCircle,
} from "lucide-react";
import { AvatarById } from "@/components/ui/MemberAvatar";
import { colorFor } from "@/lib/avatar";
import { changes, dayLabel, describe, sentence, type ActivityItem, type Category, type Part, type Tone } from "@/lib/activity";

const TONE: Record<Tone, string> = {
  added: "#14B8A6", changed: "#F59E0B", removed: "#F43F5E", money: "#8B5CF6", good: "#22C55E", bad: "#F43F5E", people: "#3B82F6", fix: "#F59E0B",
};
const ICON: Record<string, typeof Pencil> = {
  expense_added: PlusCircle, expense_edited: Pencil, expense_deleted: Trash2, expense_restored: RotateCcw,
  settlement_recorded: ArrowRightLeft, settlement_confirmed: CheckCircle2, settlement_rejected: XCircle,
  member_joined: UserPlus, member_added: UserPlus, member_claimed: UserCheck, claim_undone: Undo2,
  member_left: LogOut, member_removed: UserMinus, account_deleted: UserMinus, invite_disputed: XCircle,
};
const FILTERS: { key: Category | "all"; label: string }[] = [
  { key: "all", label: "All" }, { key: "bills", label: "Bills" }, { key: "payments", label: "Payments" }, { key: "people", label: "People" },
];

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** A headline piece: people in their own colour, the bill in bold, the rest muted. */
function PartView({ p, me }: { p: Part; me?: string }) {
  if (p.t === "person") {
    const mine = !!p.id && p.id === me;
    return (
      <span className="font-bold" style={{ color: mine ? "var(--accent)" : p.id ? colorFor(p.id) : "var(--text-primary)" }}>
        {p.text}
      </span>
    );
  }
  if (p.t === "thing") return <span className="font-bold text-[var(--text-primary)]">{p.text}</span>;
  return <span className="text-[var(--text-secondary)]">{p.text}</span>;
}

/** The group timeline: filter chips, day headers, one tinted card per change. */
export default function ActivityFeed({
  items, me, isAdmin, loading, failed, busy, error, onRestore,
}: {
  items: ActivityItem[];
  me?: string;
  isAdmin: boolean;
  loading: boolean;
  failed: boolean;
  busy: string | null;
  error: string | null;
  onRestore: (expenseId: string) => void;
}) {
  const [filter, setFilter] = useState<Category | "all">("all");
  const user = me ? { id: me } : undefined;
  const all = useMemo(() => items.map((a) => ({ a, d: describe(a, me) })), [items, me]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length, bills: 0, payments: 0, people: 0 };
    for (const x of all) c[x.d.category]++;
    return c;
  }, [all]);
  const shown = filter === "all" ? all : all.filter((x) => x.d.category === filter);
  const restore = onRestore;
  let lastDay = "";
  return (
    <>
            {/* Filters */}
            <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-5 px-5 pb-1 mb-4" role="tablist">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`flex-shrink-0 px-3.5 py-2 rounded-full text-[13px] font-bold border transition-colors ${
                    filter === f.key ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "bg-[var(--paper)] border-[var(--hairline)] text-[var(--text-secondary)]"
                  }`}
                >
                  {f.label}
                  {counts[f.key] > 0 && <span className={`ml-1.5 ${filter === f.key ? "text-white/80" : "text-[var(--text-muted)]"}`}>{counts[f.key]}</span>}
                </button>
              ))}
            </div>

            {error && <p role="alert" className="mb-3 text-[13px] font-medium text-[var(--negative)]">{error}</p>}

            {loading ? (
              <div className="flex justify-center py-12"><div className="spinner" /></div>
            ) : failed ? (
              <p className="text-[14px] text-[var(--text-secondary)]">Couldn&apos;t load the activity. Try again in a moment.</p>
            ) : shown.length === 0 ? (
              <div className="p-6 rounded-[20px] bg-[var(--paper)] border border-[var(--hairline)] text-center text-[14px] text-[var(--text-secondary)]">
                {all.length === 0 ? "Nothing yet. Every change from now on shows up here, for everyone in the group." : "Nothing of this kind yet."}
              </div>
            ) : (
              <ol className="relative">
                {shown.map(({ a, d }, i) => {
                  const Icon = ICON[a.kind] ?? Pencil;
                  const tone = TONE[d.tone];
                  const diff = a.kind === "expense_edited" ? changes(a.summary.before, a.summary.after) : [];
                  const deleted = a.kind === "expense_deleted";
                  const canRestore = deleted && a.expenseDeleted && a.expenseId && (isAdmin || a.actor?.id === user?.id);
                  const day = dayLabel(a.createdAt);
                  const newDay = day !== lastDay;
                  lastDay = day;
                  const last = i === shown.length - 1;
                  return (
                    <Fragment key={a.id}>
                      {newDay && (
                        <li className="sticky top-0 z-[1] -mx-5 px-5 py-2 mb-1 bg-[var(--ink)]/95 backdrop-blur-sm">
                          <span className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{day}</span>
                        </li>
                      )}
                      <li className="relative flex gap-3 pb-3" aria-label={sentence(a, user?.id)}>
                        {/* timeline rail */}
                        {!last && <span className="absolute left-[19px] top-11 bottom-0 w-[2px] rounded-full" style={{ backgroundColor: `${tone}33` }} aria-hidden />}
                        {/* icon, with the person's avatar */}
                        <span className="relative flex-shrink-0 w-10 h-10 rounded-[14px] flex items-center justify-center" style={{ backgroundColor: `${tone}1F`, color: tone }}>
                          <Icon size={18} strokeWidth={2.4} />
                          {a.actor && (
                            <span className="absolute -bottom-1.5 -right-1.5 flex rounded-full ring-2 ring-[var(--ink)]">
                              <AvatarById id={a.actor.id} name={a.actor.name} size={18} />
                            </span>
                          )}
                        </span>

                        {/* card */}
                        <div
                          className={`flex-1 min-w-0 rounded-[16px] border bg-[var(--paper)] px-3.5 py-3 ${deleted ? "border-[#F43F5E]/30" : "border-[var(--hairline)]"}`}
                          style={{ boxShadow: `inset 3px 0 0 ${tone}` }}
                        >
                          <div className="flex items-start gap-2">
                            <p className={`flex-1 min-w-0 text-[14px] leading-snug ${deleted ? "[&_span.font-bold:last-child]:line-through" : ""}`}>
                              {d.parts.map((p, k) => (
                                <Fragment key={k}>{k > 0 && " "}<PartView p={p} me={user?.id} /></Fragment>
                              ))}
                            </p>
                            {d.amount && (
                              <span
                                className={`flex-shrink-0 px-2 py-0.5 rounded-[8px] text-[13px] font-bold tabular-nums ${deleted ? "line-through" : ""}`}
                                style={{ backgroundColor: `${tone}1A`, color: tone }}
                              >
                                {d.amount}
                              </span>
                            )}
                          </div>

                          {diff.length > 0 && (
                            <div className="mt-2.5 space-y-1.5">
                              {diff.map((c) => (
                                <div key={c.label} className="flex items-center gap-2 text-[12.5px]">
                                  <span className="w-[92px] flex-shrink-0 truncate font-semibold text-[var(--text-secondary)]">{c.label}</span>
                                  {c.from !== null ? (
                                    <span className="px-1.5 py-0.5 rounded-[6px] bg-[#F43F5E]/10 text-[#E11D48] line-through tabular-nums truncate">{c.from}</span>
                                  ) : (
                                    <span className="text-[var(--text-muted)]">new</span>
                                  )}
                                  <ArrowRight size={12} className="text-[var(--text-muted)] flex-shrink-0" />
                                  {c.to !== null ? (
                                    <span className="px-1.5 py-0.5 rounded-[6px] bg-[#22C55E]/12 text-[#16A34A] font-bold tabular-nums truncate">{c.to}</span>
                                  ) : (
                                    <span className="text-[var(--text-muted)]">removed</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-[6px]" style={{ backgroundColor: `${tone}14`, color: tone }}>
                              {d.label}
                            </span>
                            <span className="text-[12px] text-[var(--text-muted)]">{time(a.createdAt)}</span>
                            {canRestore && (
                              <button
                                onClick={() => restore(a.expenseId!)}
                                disabled={busy !== null}
                                className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-bold bg-[var(--accent-subtle)] text-[var(--accent)]"
                              >
                                {busy === a.expenseId ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Restore
                              </button>
                            )}
                            {deleted && !a.expenseDeleted && <span className="ml-auto text-[12px] font-semibold text-[#14B8A6]">Restored</span>}
                          </div>
                        </div>
                      </li>
                    </Fragment>
                  );
                })}
              </ol>
            )}

    </>
  );
}
