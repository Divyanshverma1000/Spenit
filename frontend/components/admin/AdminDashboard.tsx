"use client";

import { useState } from "react";
import { AlertTriangle, Bot, CheckCircle2 } from "lucide-react";

export interface Day {
  day: string;
  active: number; signups: number; expenses: number; imports: number; payments: number; groups: number;
  ai_calls: number; ai_failures: number; chat_questions: number; tokens_in: number; tokens_out: number; errors: number;
}
export interface Stats {
  generatedAt: string;
  people: { total: number; new_today: number; new_7d: number; new_30d: number; live: number; dau: number; wau: number; mau: number; not_joined: number; retention: { cohort: number; returned: number } };
  product: { groups: number; expenses: number; imported_orders: number; payments_confirmed: number; money_tracked: number; active_groups_7d: number };
  ai: { calls30d: number; failures30d: number; chat30d: number; tokensIn30d: number; tokensOut30d: number; costUsd30d: number; pricePerMillion: { in: number; out: number } };
  series: Day[];
  errors: { fingerprint: string; source: string; message: string; path: string | null; count: number; last_at: string; first_at: string }[];
  feedback?: { open: number; total: number; items: { id: number; kind: string; message: string; page: string | null; app_version: string | null; device: string | null; status: string; created_at: string; name: string; email: string | null }[] };
}

/** Bars: one colour that passes the palette checks on both the light and dark surface. */
const BAR = "#D97706";
const n = (v: number) => v.toLocaleString("en-IN");
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const shortDay = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function Tile({ label, value, sub, live }: { label: string; value: string; sub?: string; live?: boolean }) {
  return (
    <div className="rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] p-3.5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
        {live && <span className="relative flex w-2 h-2"><span className="absolute inline-flex w-full h-full rounded-full bg-[#22C55E] opacity-60 animate-ping" /><span className="relative inline-flex w-2 h-2 rounded-full bg-[#22C55E]" /></span>}
        {label}
      </p>
      <p className="mt-1 text-[24px] font-black tabular-nums text-[var(--text-primary)] leading-tight">{value}</p>
      {sub && <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * 30 days of one measure as bars: thin, rounded data-ends on the baseline, 2px gaps,
 * a hover/tap readout, today's value and the peak labelled, and a table view.
 */
function Bars({ title, days, pick, unit = "" }: { title: string; days: Day[]; pick: (d: Day) => number; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map(pick);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const shown = hover ?? values.length - 1;
  const H = 72;
  return (
    <section className="rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-bold text-[var(--text-primary)]">{title}</h3>
        <span className="text-[12px] text-[var(--text-secondary)] tabular-nums">{n(total)} in 30 days</span>
      </div>
      <p className="mt-1 text-[12px] text-[var(--text-secondary)] h-4 tabular-nums" aria-live="polite">
        {days[shown] && <><b className="text-[var(--text-primary)]">{n(values[shown])}{unit}</b> on {shortDay(days[shown].day)}{hover === null ? " (today)" : ""}</>}
      </p>
      <div className="mt-2 relative" style={{ height: H }} onMouseLeave={() => setHover(null)}>
        {/* recessive baseline */}
        <div className="absolute left-0 right-0 bottom-0 h-px bg-[var(--hairline)]" />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {values.map((v, i) => (
            <button
              key={days[i].day}
              type="button"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => setHover(i)}
              aria-label={`${shortDay(days[i].day)}: ${v}${unit}`}
              className="flex-1 h-full flex items-end group outline-none"
            >
              <span
                className="w-full rounded-t-[4px] transition-opacity"
                style={{
                  height: v > 0 ? Math.max(3, (v / max) * H) : 0,
                  backgroundColor: BAR,
                  opacity: hover === null || hover === i ? 1 : 0.35,
                }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-[var(--text-muted)] tabular-nums">
        <span>{days[0] && shortDay(days[0].day)}</span>
        <span>peak {n(max === 1 && total === 0 ? 0 : max)}{unit}</span>
        <span>today</span>
      </div>
      <details className="mt-2 text-[12px]">
        <summary className="cursor-pointer text-[var(--text-muted)]">Table</summary>
        <table className="mt-2 w-full tabular-nums">
          <tbody>
            {days.slice().reverse().map((d, i) => (
              <tr key={d.day} className="border-t border-[var(--hairline)]">
                <td className="py-1 text-[var(--text-secondary)]">{shortDay(d.day)}</td>
                <td className="py-1 text-right text-[var(--text-primary)]">{n(values[values.length - 1 - i])}{unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

/** Everything on the admin page below the header. */
export function AdminDashboard({ s, onFeedbackDone }: { s: Stats; onFeedbackDone?: (id: number, done: boolean) => void }) {
  return (
            <>
              <section>
                <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">People</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <Tile label="Live now" value={n(s.people.live)} sub="active in the last 5 min" live />
                  <Tile label="Today" value={n(s.people.dau)} sub="used Spenit today" />
                  <Tile label="This week" value={n(s.people.wau)} sub="last 7 days" />
                  <Tile label="This month" value={n(s.people.mau)} sub={s.people.mau ? `today is ${Math.round((s.people.dau / s.people.mau) * 100)}% of the month` : "last 30 days"} />
                  <Tile label="Accounts" value={n(s.people.total)} sub={`+${n(s.people.new_today)} today · +${n(s.people.new_7d)} this week`} />
                  <Tile
                    label="Came back"
                    value={s.people.retention.cohort ? `${Math.round((s.people.retention.returned / s.people.retention.cohort) * 100)}%` : "–"}
                    sub={s.people.retention.cohort ? `of ${n(s.people.retention.cohort)} who joined 8–30 days ago` : "not enough sign-ups yet"}
                  />
                </div>
              </section>
  
              <section>
                <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">What people do</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <Tile label="Groups" value={n(s.product.groups)} sub={`${n(s.product.active_groups_7d)} active this week`} />
                  <Tile label="Bills" value={n(s.product.expenses)} sub={`${n(s.product.imported_orders)} imported orders`} />
                  <Tile label="Payments" value={n(s.product.payments_confirmed)} sub="confirmed settle-ups" />
                  <Tile label="Money tracked" value={inr(s.product.money_tracked)} sub="all bills" />
                  <Tile label="Not joined yet" value={n(s.people.not_joined)} sub="names added by admins" />
                  <Tile label="Revenue" value="–" sub="payments not set up yet" />
                </div>
              </section>
  
              <section className="grid sm:grid-cols-2 gap-2.5">
                <Bars title="Active people" days={s.series} pick={(d) => d.active} />
                <Bars title="New sign-ups" days={s.series} pick={(d) => d.signups} />
                <Bars title="Bills added" days={s.series} pick={(d) => d.expenses} />
                <Bars title="Orders imported" days={s.series} pick={(d) => d.imports} />
                <Bars title="Payments recorded" days={s.series} pick={(d) => d.payments} />
                <Bars title="Assistant questions" days={s.series} pick={(d) => d.chat_questions} />
              </section>
  
              <section>
                <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">AI</h2>
                <div className="rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] p-4">
                  <div className="flex items-center gap-2"><Bot size={18} className="text-[var(--text-secondary)]" /><span className="font-bold">Last 30 days</span></div>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
                    <div><p className="text-[var(--text-muted)]">Calls</p><p className="text-[18px] font-black tabular-nums">{n(s.ai.calls30d)}</p></div>
                    <div>
                      <p className="text-[var(--text-muted)]">Failed</p>
                      <p className="text-[18px] font-black tabular-nums">{s.ai.calls30d ? `${Math.round((s.ai.failures30d / s.ai.calls30d) * 100)}%` : "–"}</p>
                    </div>
                    <div><p className="text-[var(--text-muted)]">Tokens</p><p className="text-[18px] font-black tabular-nums">{n(Math.round((s.ai.tokensIn30d + s.ai.tokensOut30d) / 1000))}k</p></div>
                    <div><p className="text-[var(--text-muted)]">Cost (est.)</p><p className="text-[18px] font-black tabular-nums">${s.ai.costUsd30d.toFixed(2)}</p></div>
                  </div>
                  <p className="mt-3 text-[11px] text-[var(--text-muted)]">
                    Estimate at ${s.ai.pricePerMillion.in}/M input and ${s.ai.pricePerMillion.out}/M output tokens. Calls made with people&apos;s own keys aren&apos;t billed to you.
                  </p>
                </div>
                <div className="mt-2.5"><Bars title="AI calls" days={s.series} pick={(d) => d.ai_calls} /></div>
              </section>
  
              <section>
              <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                What people told us{s.feedback ? ` · ${s.feedback.open} open of ${s.feedback.total}` : ""}
              </h2>
              {!s.feedback || s.feedback.items.length === 0 ? (
                <div className="p-4 rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] text-[14px] text-[var(--text-secondary)]">
                  No reports or ideas yet. They arrive here from Profile → Report a problem.
                </div>
              ) : (
                <ul className="rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] divide-y divide-[var(--hairline)] overflow-hidden">
                  {s.feedback.items.map((f) => (
                    <li key={f.id} className={`p-3.5 ${f.status === "done" ? "opacity-55" : ""}`}>
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--paper-dim)] text-[var(--text-secondary)] flex-shrink-0">
                          {f.kind === "problem" ? "Problem" : f.kind === "idea" ? "Idea" : f.kind === "test" ? "Test" : "Other"}
                        </span>
                        <p className="flex-1 text-[13.5px] text-[var(--text-primary)] whitespace-pre-wrap break-words">{f.message}</p>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-[var(--text-muted)]">
                        <span className="truncate">
                          {f.name}{f.email ? ` · ${f.email}` : ""} · {f.page ?? "—"} · {f.device ?? ""} · {f.app_version ?? ""} · {ago(f.created_at)}
                        </span>
                        {onFeedbackDone && (
                          <button onClick={() => onFeedbackDone(f.id, f.status !== "done")} className="ml-auto flex-shrink-0 font-bold text-[var(--accent)]">
                            {f.status === "done" ? "Reopen" : "Mark done"}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
                <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Errors · last 7 days</h2>
                {s.errors.length === 0 ? (
                  <div className="p-4 rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] flex items-center gap-2 text-[14px]">
                    <CheckCircle2 size={18} className="text-[#16A34A]" /> No errors. All good.
                  </div>
                ) : (
                  <ul className="rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] divide-y divide-[var(--hairline)] overflow-hidden">
                    {s.errors.map((e) => (
                      <li key={e.fingerprint} className="p-3.5 flex items-start gap-3">
                        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-[#DC2626]" aria-label="Error" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-[var(--text-primary)] break-words">{e.message}</p>
                          <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">
                            <span className="font-bold uppercase text-[10px] tracking-wider px-1.5 py-0.5 rounded bg-[var(--paper-dim)] mr-1.5">{e.source === "api" ? "Server" : "App"}</span>
                            {e.path ?? "—"} · last {ago(e.last_at)}
                          </p>
                        </div>
                        <span className="text-[13px] font-bold tabular-nums text-[var(--text-primary)]">{n(e.count)}×</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2.5"><Bars title="Errors" days={s.series} pick={(d) => d.errors} /></div>
              </section>
            </>
    );
}
