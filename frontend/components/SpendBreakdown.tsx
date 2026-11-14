"use client";

import { Lock, User, Users } from "lucide-react";
import { ask, notice } from "@/lib/dialog";
import type { SpendBreakdown } from "@/lib/groupSpend";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const KINDS = [
  { key: "everyone", label: "Whole group", note: "Split between everyone", color: "var(--positive)", Icon: Users },
  { key: "some", label: "Some of you", note: "Shared by a few, like shopping for two", color: "var(--info)", Icon: Users },
  { key: "personal", label: "Personal", note: "One person's own. Nobody owes for these", color: "var(--text-muted)", Icon: Lock },
] as const;

/**
 * Tapping "Spent" on a group: what the total is made of, and the viewer's own part.
 * Resolves true when they chose to hide (or show again) personal bills in the list.
 */
export async function showSpendBreakdown(s: SpendBreakdown, hidingPersonal: boolean): Promise<boolean> {
  const shared = s.everyone + s.some;
  const pct = (n: number) => (s.total > 0 ? (n / s.total) * 100 : 0);
  const forOthers = Math.max(0, s.me.paid - s.me.share);

  const body = (
    <div className="mt-3 text-left">
      <p className="text-[13px]">
        <b className="text-[var(--text-primary)]">{inr(shared)}</b> of {inr(s.total)} was actually shared.
        {s.personal >= 1 && <> The other <b className="text-[var(--text-primary)]">{inr(s.personal)}</b> is personal.</>}
      </p>

      <div className="mt-3 h-3 rounded-full overflow-hidden flex bg-[var(--paper-dim)]" aria-hidden>
        {KINDS.map((k) => <span key={k.key} style={{ width: `${pct(s[k.key])}%`, background: k.color }} />)}
      </div>

      <div className="mt-3 space-y-2.5">
        {KINDS.map(({ key, label, note, color, Icon }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}>
              <Icon size={15} strokeWidth={2.4} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-[var(--text-primary)]">{label}</p>
              <p className="text-[11.5px] leading-snug">{note} · {s.bills[key]} {s.bills[key] === 1 ? "bill" : "bills"}</p>
            </div>
            <span className="text-[14px] font-extrabold tabular-nums text-[var(--text-primary)]">{inr(s[key])}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 p-3 rounded-[12px] bg-[var(--paper-dim)] text-[12.5px] flex gap-2.5">
        <User size={16} className="flex-shrink-0 mt-0.5 text-[var(--accent)]" />
        <p>
          You paid <b className="text-[var(--text-primary)]">{inr(s.me.paid)}</b>. Your own share is{" "}
          <b className="text-[var(--text-primary)]">{inr(s.me.share)}</b>
          {forOthers >= 1 ? <>, so <b className="text-[var(--text-primary)]">{inr(forOthers)}</b> was for others. Settled payments bring that back.</> : "."}
        </p>
      </div>
    </div>
  );

  const title = "Where the money went";
  if (s.bills.personal === 0 && !hidingPersonal) {
    await notice({ title, body, confirmLabel: "Got it" });
    return false;
  }
  return ask({
    title,
    body,
    confirmLabel: hidingPersonal ? "Show personal bills" : "Hide personal bills",
    cancelLabel: "Close",
  });
}
