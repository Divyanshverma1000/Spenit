"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, EyeOff, Eye, Lock, User, Users, CheckCircle2 } from "lucide-react";
import { BackClose } from "@/lib/backClose";
import {
  billsOfKind, groupSpend, inPeriod, lastSettledAt, monthLabel, monthlyTotals, periodLabel, shortINR,
  type SpendExpense, type SpendKind, type SpendPeriod, type SpendSettlement,
} from "@/lib/groupSpend";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const KINDS = [
  { key: "everyone", label: "Whole group", note: "Split between everyone", color: "var(--positive)", Icon: Users },
  { key: "some", label: "Some of you", note: "Shared by a few, like shopping for two", color: "var(--info)", Icon: Users },
  { key: "personal", label: "Personal", note: "One person's own. Nobody owes for these", color: "var(--text-muted)", Icon: Lock },
] as const;

/**
 * Tapping "Spent" on a group: what the money was, for a period you pick (since everyone
 * last settled up, a month, or all time), month by month. Tap a row to see those bills.
 *
 * Spending is never wiped by settling up: the total is the group's history. "Since
 * settled up" is the part still being sorted out.
 */
export default function SpendSheet({
  expenses, settlements, memberCount, me, hidingPersonal, onClose, onToggleHide, onShowBills,
}: {
  expenses: SpendExpense[];
  settlements: SpendSettlement[];
  memberCount: number;
  me: string;
  hidingPersonal: boolean;
  onClose: () => void;
  onToggleHide: () => void;
  onShowBills: (ids: string[], label: string) => void;
}) {
  const settledAt = useMemo(() => lastSettledAt(expenses, settlements), [expenses, settlements]);
  const months = useMemo(() => monthlyTotals(expenses), [expenses]);
  const [period, setPeriod] = useState<SpendPeriod>(() => (settledAt ? { kind: "since", at: settledAt } : { kind: "all" }));

  const inP = useMemo(() => expenses.filter((e) => inPeriod(e, period)), [expenses, period]);
  const s = useMemo(() => groupSpend(inP, memberCount, me), [inP, memberCount, me]);
  const shared = s.everyone + s.some;
  const pct = (n: number) => (s.total > 0 ? (n / s.total) * 100 : 0);
  const forOthers = Math.max(0, s.me.paid - s.me.share);
  const label = periodLabel(period);

  const chips: { p: SpendPeriod; text: string }[] = [
    ...(settledAt ? [{ p: { kind: "since", at: settledAt } as SpendPeriod, text: "Since settled up" }] : []),
    ...months.slice(-3).reverse().filter((m) => m.bills > 0).map((m) => ({ p: { kind: "month", key: m.key } as SpendPeriod, text: monthLabel(m.key) })),
    { p: { kind: "all" }, text: "All time" },
  ];
  const same = (a: SpendPeriod, b: SpendPeriod) =>
    a.kind === b.kind && (a.kind !== "month" || a.key === (b as { key: string }).key) && (a.kind !== "since" || a.at.getTime() === (b as { at: Date }).at.getTime());
  const recent = months.slice(-6);
  const top = Math.max(1, ...recent.map((m) => m.total));

  const show = (kind?: SpendKind) => {
    const list = billsOfKind(inP, memberCount, kind);
    const what = kind ? KINDS.find((k) => k.key === kind)!.label : "All bills";
    onShowBills(list.map((e) => e.id), `${what} · ${label.toLowerCase() === "all time" ? "all time" : label}`);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/45" onClick={onClose}>
      <BackClose onClose={onClose} />
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 30, stiffness: 380 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Where the money went"
        className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-[var(--paper)] rounded-t-[28px] px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--hairline)]" aria-hidden />
        <p className="font-extrabold text-[18px] text-[var(--text-primary)]">Where the money went</p>

        {/* Period */}
        <div className="mt-3 -mx-5 px-5 flex gap-2 overflow-x-auto hide-scrollbar">
          {chips.map(({ p, text }) => (
            <button
              key={text}
              onClick={() => setPeriod(p)}
              className={`h-9 px-3.5 rounded-full text-[13px] font-bold whitespace-nowrap border-2 flex-shrink-0 ${
                same(p, period) ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]" : "border-[var(--hairline)] text-[var(--text-secondary)]"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
        {period.kind === "since" && (
          <p className="mt-2 text-[12px] text-[var(--text-secondary)] flex items-center gap-1.5">
            <CheckCircle2 size={13} className="text-[var(--positive)]" />
            Everyone was square on {period.at.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}. This is what&rsquo;s been spent since.
          </p>
        )}

        {/* Month by month */}
        {recent.length > 1 && (
          <div className="mt-4">
            <div className="flex items-end gap-1.5 h-[72px]">
              {recent.map((m) => {
                const on = period.kind === "month" && period.key === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => setPeriod({ kind: "month", key: m.key })}
                    className="flex-1 h-full flex flex-col justify-end items-center gap-1"
                    aria-label={`${monthLabel(m.key, true)}: ${inr(m.total)}`}
                  >
                    <span className="text-[10px] font-bold tabular-nums text-[var(--text-secondary)]">{m.total > 0 ? shortINR(m.total) : ""}</span>
                    <span
                      className="w-full max-w-[34px] rounded-t-[6px] transition-colors"
                      style={{ height: `${Math.max(3, (m.total / top) * 44)}px`, background: on ? "var(--accent)" : "color-mix(in srgb, var(--accent) 35%, var(--paper-dim))" }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1.5 mt-1">
              {recent.map((m) => (
                <span key={m.key} className={`flex-1 text-center text-[10.5px] font-semibold ${period.kind === "month" && period.key === m.key ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}`}>{monthLabel(m.key)}</span>
              ))}
            </div>
          </div>
        )}

        {/* Total for the period */}
        <button onClick={() => show()} className="mt-4 w-full flex items-center justify-between p-3.5 rounded-[16px] bg-[var(--paper-dim)] text-left" disabled={inP.length === 0}>
          <span>
            <span className="block text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
            <span className="block text-[22px] font-black tabular-nums text-[var(--text-primary)]">{inr(s.total)}</span>
            <span className="block text-[12px] text-[var(--text-secondary)]">
              {inP.length === 0 ? "No bills yet" : <>{inr(shared)} shared{s.personal >= 1 ? <> · {inr(s.personal)} personal</> : null} · {inP.length} {inP.length === 1 ? "bill" : "bills"}</>}
            </span>
          </span>
          {inP.length > 0 && <ChevronRight size={18} className="text-[var(--text-muted)]" />}
        </button>

        {inP.length > 0 && (
          <>
            <div className="mt-3 h-3 rounded-full overflow-hidden flex bg-[var(--paper-dim)]" aria-hidden>
              {KINDS.map((k) => <span key={k.key} style={{ width: `${pct(s[k.key])}%`, background: k.color }} />)}
            </div>

            <div className="mt-2 divide-y divide-[var(--hairline)]">
              {KINDS.map(({ key, label: name, note, color, Icon }) => {
                const n = s.bills[key];
                return (
                  <button
                    key={key}
                    onClick={() => show(key)}
                    disabled={n === 0}
                    className="w-full py-3 flex items-center gap-3 text-left disabled:opacity-50"
                  >
                    <span className="w-9 h-9 rounded-[11px] flex items-center justify-center flex-shrink-0" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
                      <Icon size={16} strokeWidth={2.4} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14.5px] font-bold text-[var(--text-primary)]">{name}</span>
                      <span className="block text-[12px] leading-snug text-[var(--text-secondary)]">{note} · {n === 0 ? "none" : `in ${n} ${n === 1 ? "bill" : "bills"}`}</span>
                    </span>
                    <span className="text-[15px] font-extrabold tabular-nums text-[var(--text-primary)]">{inr(s[key])}</span>
                    {n > 0 && <ChevronRight size={16} className="text-[var(--text-muted)] -ml-1" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 p-3 rounded-[14px] bg-[var(--paper-dim)] text-[13px] text-[var(--text-secondary)] flex gap-2.5">
              <User size={16} className="flex-shrink-0 mt-0.5 text-[var(--accent)]" />
              <p>
                You paid <b className="text-[var(--text-primary)]">{inr(s.me.paid)}</b>. Your own share is{" "}
                <b className="text-[var(--text-primary)]">{inr(s.me.share)}</b>
                {forOthers >= 1 ? <>, so <b className="text-[var(--text-primary)]">{inr(forOthers)}</b> was for others.</> : "."}
              </p>
            </div>
          </>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button onClick={onToggleHide} className="py-3.5 rounded-[16px] bg-[var(--paper-dim)] font-bold text-[14px] text-[var(--text-secondary)] flex items-center justify-center gap-1.5">
            {hidingPersonal ? <><Eye size={16} /> Show personal</> : <><EyeOff size={16} /> Hide personal</>}
          </button>
          <button onClick={onClose} className="py-3.5 rounded-[16px] bg-[var(--accent)] text-white font-bold text-[14px]">Done</button>
        </div>
        <p className="mt-3 text-[11.5px] text-[var(--text-muted)] text-center">Settling up clears what people owe. It never removes bills from the group&rsquo;s history.</p>
      </motion.div>
    </div>
  );
}
