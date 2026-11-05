"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, CornerDownLeft, Loader2, Plus, Sparkles, Target, Users } from "lucide-react";
import { parseQuickAdd, type QuickEntry } from "@/lib/quickAdd";
import { budgetPace, dayOf, dayTitle, inr, metaFor, monthLabel, shiftMonth, type SpendEntry, type SpendingOverview } from "@/lib/spending";

/** Bars: one colour that passes the palette checks on the light and dark surfaces. */
const BAR = "#D97706";

function CatTile({ category, size = 40 }: { category: string; size?: number }) {
  const m = metaFor(category);
  const Icon = m.icon;
  return (
    <span className="flex-shrink-0 rounded-[13px] flex items-center justify-center" style={{ width: size, height: size, backgroundColor: `${m.tint}1F`, color: m.tint }}>
      <Icon size={Math.round(size * 0.45)} strokeWidth={2.2} />
    </span>
  );
}

const whenLabel = (daysAgo: number) => (daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo} days ago`);

/**
 * The Spending tab: this month at a glance (with budget pace), a two-second quick add,
 * where the money went, every day of the month, and the full timeline, where your share
 * of group bills appears next to what you logged yourself.
 */
export function SpendingView({
  o, month, onMonth, onQuickAdd, onOpenAdd, onEdit, onBudget, onAsk, quickBusy,
}: {
  onAsk: () => void;
  o: SpendingOverview | undefined;
  month: string;
  onMonth: (m: string) => void;
  onQuickAdd: (e: QuickEntry) => Promise<boolean>;
  onOpenAdd: (prefill?: Partial<{ description: string; amount: string; category: string }>) => void;
  onEdit: (e: SpendEntry) => void;
  onBudget: () => void;
  quickBusy: boolean;
}) {
  const [text, setText] = useState("");
  const [dayFocus, setDayFocus] = useState<number | null>(null);
  const parsed = useMemo(() => parseQuickAdd(text), [text]);
  const pace = o ? budgetPace(o) : null;
  const grouped = useMemo(() => {
    const map = new Map<string, SpendEntry[]>();
    for (const e of o?.entries ?? []) {
      const d = dayOf(e.at);
      map.set(d, [...(map.get(d) ?? []), e]);
    }
    return [...map];
  }, [o?.entries]);
  const maxDay = Math.max(1, ...(o?.byDay ?? []).map((d) => d.total));
  const topCat = o?.byCategory[0];
  const dayShown = o ? (dayFocus ?? (o.isCurrentMonth ? Number(o.today.slice(8, 10)) - 1 : null)) : null;

  async function submitQuick() {
    if (!parsed) return;
    if (await onQuickAdd(parsed)) setText("");
  }

  return (
    <div className="space-y-5">
      {/* ── Month ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <button onClick={() => onMonth(shiftMonth(month, -1))} className="w-10 h-10 rounded-full flex items-center justify-center bg-[var(--paper)] border border-[var(--hairline)]" aria-label="Previous month">
          <ChevronLeft size={18} />
        </button>
        <p className="text-[15px] font-bold">{monthLabel(month)}</p>
        <button
          onClick={() => onMonth(shiftMonth(month, 1))}
          disabled={!!o?.isCurrentMonth}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-[var(--paper)] border border-[var(--hairline)] disabled:opacity-30"
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* ── Hero ───────────────────────────────────────────── */}
      <motion.section
        key={month}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[28px] p-5 text-white shadow-[0_18px_40px_-18px_rgba(245,158,11,0.5)]"
        style={{ background: "radial-gradient(120% 90% at 100% 0%, #3B2A12 0%, #1C1A17 45%, #121316 100%)" }}
      >
        <div className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full bg-[#F59E0B] opacity-20 blur-3xl" />
        <p className="relative text-[12px] font-bold uppercase tracking-[0.14em] text-white/60">
          {o?.isCurrentMonth ? "Spent this month" : `Spent in ${monthLabel(month, { month: "long" })}`}
        </p>
        <p className="relative mt-1 text-[42px] font-black tracking-tight tabular-nums leading-none">{o ? inr(o.total) : "…"}</p>
        {o && (
          <p className="relative mt-2.5 text-[13px] text-white/70 leading-snug">
            {inr(o.personalTotal)} on your own · <span className="inline-flex items-center gap-1"><Users size={12} /> {inr(o.groupShareTotal)}</span> your share in groups
          </p>
        )}
        {o && o.prevTotal > 0 && (
          <p className="relative mt-1 text-[12px] text-white/55">
            {monthLabel(o.prevMonth, { month: "long" })}: {inr(o.prevTotal)}
            {!o.isCurrentMonth && o.prevTotal > 0 && ` · ${o.total <= o.prevTotal ? `${Math.round((1 - o.total / o.prevTotal) * 100)}% less` : `${Math.round((o.total / o.prevTotal - 1) * 100)}% more`}`}
          </p>
        )}

        {/* Budget */}
        {o && (pace ? (
          <button onClick={onBudget} className="relative mt-4 w-full text-left rounded-[18px] bg-white/[0.07] border border-white/10 p-3">
            <div className="flex items-center justify-between text-[12px] font-semibold">
              <span className="text-white/70">Budget {inr(o.budget!)}</span>
              <span className={pace.status === "over" ? "text-[#FB7185]" : pace.status === "ahead" ? "text-[#FCD34D]" : "text-[#4ADE80]"}>
                {pace.status === "over" ? `Over by ${inr(-pace.left)}` : pace.status === "ahead" ? "Running ahead" : "On track"}
              </span>
            </div>
            <div className="relative mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pace.spentShare * 100}%`, backgroundColor: pace.status === "over" ? "#FB7185" : pace.status === "ahead" ? "#FCD34D" : "#4ADE80" }} />
              {o.isCurrentMonth && <div className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-white/70 rounded-full" style={{ left: `${pace.monthShare * 100}%` }} title="Today" />}
            </div>
            <p className="mt-2 text-[12px] text-white/65">
              {pace.left >= 0
                ? o.isCurrentMonth && pace.daysLeft > 0
                  ? <>{inr(pace.left)} left · about <b className="text-white">{inr(Math.floor(pace.perDay))}</b> a day for {pace.daysLeft} {pace.daysLeft === 1 ? "day" : "days"}</>
                  : <>{inr(pace.left)} under budget</>
                : "Spent more than planned this month"}
            </p>
          </button>
        ) : (
          <button onClick={onBudget} className="relative mt-4 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/[0.08] border border-white/10 text-[12.5px] font-semibold text-white/85">
            <Target size={14} /> Set a monthly budget
          </button>
        ))}
      </motion.section>

      {/* ── Quick add ──────────────────────────────────────── */}
      <section>
        <form
          onSubmit={(e) => { e.preventDefault(); void submitQuick(); }}
          className="flex items-center gap-2 rounded-[20px] bg-[var(--paper)] border border-[var(--hairline)] pl-4 pr-2 py-2 focus-within:ring-2 focus-within:ring-[var(--accent-subtle)]"
        >
          <Plus size={18} className="text-[var(--accent)] flex-shrink-0" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="chai 20, auto 60 yesterday…"
            aria-label="Quick add an expense"
            enterKeyHint="done"
            className="flex-1 min-w-0 bg-transparent py-2 text-[15px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!parsed || quickBusy}
            className="h-10 px-3.5 rounded-[14px] bg-[var(--accent)] text-white font-bold text-[13px] flex items-center gap-1.5 disabled:opacity-30"
            aria-label="Add"
          >
            {quickBusy ? <Loader2 size={15} className="animate-spin" /> : <CornerDownLeft size={15} />} Add
          </button>
        </form>
        {/* What it understood */}
        {text.trim() && (
          <div className="mt-2 flex items-center gap-2.5 px-1">
            {parsed ? (
              <>
                <CatTile category={parsed.category} size={28} />
                <p className="flex-1 text-[13px] text-[var(--text-secondary)] truncate">
                  <b className="text-[var(--text-primary)]">{parsed.description}</b> · {inr(parsed.amount)} · {metaFor(parsed.category).label} · {whenLabel(parsed.daysAgo)}
                </p>
                <button
                  onClick={() => onOpenAdd({ description: parsed.description, amount: String(parsed.amount), category: parsed.category })}
                  className="text-[12px] font-bold text-[var(--accent)] flex-shrink-0"
                >
                  Change
                </button>
              </>
            ) : (
              <p className="text-[13px] text-[var(--text-muted)]">Add an amount, like <b>chai 20</b></p>
            )}
          </div>
        )}
        {/* One tap for things you log often */}
        {!text.trim() && (o?.frequent.length ?? 0) > 0 && (
          <div className="mt-2.5 flex gap-2 overflow-x-auto hide-scrollbar -mx-1 px-1 pb-1">
            {o!.frequent.map((f) => {
              const m = metaFor(f.category);
              const Icon = m.icon;
              return (
                <button
                  key={`${f.description}-${f.amount}`}
                  onClick={() => void onQuickAdd({ description: f.description, amount: f.amount, category: f.category as QuickEntry["category"], daysAgo: 0 })}
                  disabled={quickBusy}
                  className="flex-shrink-0 flex items-center gap-1.5 pl-2 pr-3 py-1.5 rounded-full bg-[var(--paper)] border border-[var(--hairline)] text-[13px] font-semibold active:scale-95 transition-transform"
                >
                  <span style={{ color: m.tint }}><Icon size={14} strokeWidth={2.4} /></span>
                  {f.description} <span className="text-[var(--text-muted)] tabular-nums">{inr(f.amount)}</span>
                </button>
              );
            })}
          </div>
        )}
        <button onClick={() => onOpenAdd()} className="mt-2 px-1 text-[12.5px] font-semibold text-[var(--text-secondary)] inline-flex items-center gap-1">
          More options <ArrowRight size={13} />
        </button>
      </section>

      {o && o.total === 0 ? (
        <section className="rounded-[24px] bg-[var(--paper)] border border-[var(--hairline)] p-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/illustrations/no-expenses.webp" alt="" className="w-32 h-32 mx-auto object-contain" />
          <p className="mt-2 font-bold text-[16px]">{o.isCurrentMonth ? "Nothing spent yet this month" : "Nothing in this month"}</p>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            Type <b>chai 20</b> above to log your first one. Your share of group bills shows up here by itself.
          </p>
        </section>
      ) : o ? (
        <>
          {/* ── Where it went ────────────────────────────────── */}
          <section>
            <div className="flex items-baseline justify-between mb-2 px-1">
              <h2 className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Where it went</h2>
              {topCat && <span className="text-[12px] text-[var(--text-muted)]">{metaFor(topCat.category).label} is the biggest</span>}
            </div>
            <div className="rounded-[22px] bg-[var(--paper)] border border-[var(--hairline)] divide-y divide-[var(--hairline)]">
              {o.byCategory.map((c) => {
                const share = o.total ? c.total / o.total : 0;
                return (
                  <div key={c.category} className="flex items-center gap-3 px-3.5 py-3">
                    <CatTile category={c.category} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[14px] font-semibold truncate">{metaFor(c.category).label}</span>
                        <span className="text-[14px] font-bold tabular-nums">{inr(c.total)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-[6px] rounded-full bg-[var(--paper-dim)] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(2, share * 100)}%`, backgroundColor: BAR }} />
                        </div>
                        <span className="w-9 text-right text-[11px] text-[var(--text-muted)] tabular-nums">{Math.round(share * 100)}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Every day ────────────────────────────────────── */}
          <section className="rounded-[22px] bg-[var(--paper)] border border-[var(--hairline)] p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Every day</h2>
              <span className="text-[12px] text-[var(--text-secondary)] tabular-nums" aria-live="polite">
                {dayShown !== null && o.byDay[dayShown] && <><b className="text-[var(--text-primary)]">{inr(o.byDay[dayShown].total)}</b> on {new Date(`${o.byDay[dayShown].day}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</>}
              </span>
            </div>
            <div className="mt-3 h-[64px] flex items-end gap-[2px] border-b border-[var(--hairline)]" onMouseLeave={() => setDayFocus(null)}>
              {o.byDay.map((d, i) => {
                const future = o.isCurrentMonth && d.day > o.today;
                return (
                  <button
                    key={d.day}
                    type="button"
                    onMouseEnter={() => setDayFocus(i)}
                    onFocus={() => setDayFocus(i)}
                    onClick={() => setDayFocus(i)}
                    aria-label={`${d.day}: ${inr(d.total)}`}
                    className="flex-1 h-full flex items-end outline-none"
                    disabled={future}
                  >
                    <span
                      className="w-full rounded-t-[3px]"
                      style={{
                        height: d.total > 0 ? Math.max(3, (d.total / maxDay) * 64) : 0,
                        backgroundColor: BAR,
                        opacity: dayFocus === null || dayFocus === i ? 1 : 0.35,
                      }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-[var(--text-muted)] tabular-nums">
              <span>1</span>
              <span>avg {inr(Math.round(o.total / (o.isCurrentMonth ? Number(o.today.slice(8, 10)) : o.daysInMonth)))} a day</span>
              <span>{o.daysInMonth}</span>
            </div>
          </section>

          {/* ── Timeline ─────────────────────────────────────── */}
          <section>
            <h2 className="text-[13px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2 px-1">All spending</h2>
            <div className="space-y-4">
              {grouped.map(([day, list]) => (
                <div key={day}>
                  <div className="flex items-baseline justify-between px-1 mb-1.5">
                    <span className="text-[13px] font-bold text-[var(--text-primary)]">{dayTitle(day, o.today)}</span>
                    <span className="text-[12px] font-semibold text-[var(--text-secondary)] tabular-nums">{inr(list.reduce((a, e) => a + e.amount, 0))}</span>
                  </div>
                  <div className="rounded-[20px] bg-[var(--paper)] border border-[var(--hairline)] divide-y divide-[var(--hairline)] overflow-hidden">
                    {list.map((e) => {
                      const row = (
                        <>
                          <CatTile category={e.category} size={38} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[14.5px] font-semibold truncate">{e.description}</p>
                            <p className="text-[12px] text-[var(--text-muted)] truncate">
                              {e.kind === "group" ? (
                                <span className="inline-flex items-center gap-1"><Users size={11} /> {e.groupName} · your share</span>
                              ) : (
                                metaFor(e.category).label
                              )}
                            </p>
                          </div>
                          <span className="text-[14.5px] font-bold tabular-nums">{inr(e.amount)}</span>
                        </>
                      );
                      return e.kind === "group" ? (
                        <Link key={`g-${e.id}`} href={`/groups/${e.groupId}`} className="flex items-center gap-3 px-3.5 py-3 active:bg-[var(--paper-dim)]">{row}</Link>
                      ) : (
                        <button key={`p-${e.id}`} onClick={() => onEdit(e)} className="w-full text-left flex items-center gap-3 px-3.5 py-3 active:bg-[var(--paper-dim)]">{row}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <button onClick={onAsk} className="w-full text-left flex items-center gap-3 rounded-[20px] bg-[var(--paper)] border border-[var(--hairline)] p-4">
            <span className="w-10 h-10 rounded-[13px] bg-[var(--accent-subtle)] text-[var(--accent)] flex items-center justify-center"><Sparkles size={18} /></span>
            <span className="flex-1">
              <span className="block text-[14px] font-bold">Ask about your spending</span>
              <span className="block text-[12px] text-[var(--text-secondary)]">&quot;How much on milk this month?&quot;</span>
            </span>
            <ChevronRight size={18} className="text-[var(--text-muted)]" />
          </button>
        </>
      ) : (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-[var(--text-muted)]" /></div>
      )}

    </div>
  );
}
