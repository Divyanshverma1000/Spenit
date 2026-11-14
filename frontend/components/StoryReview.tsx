"use client";

import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, CheckCircle2, Loader2, Undo2, Wallet } from "lucide-react";
import MemberAvatar from "@/components/ui/MemberAvatar";
import { CategoryIcon } from "@/components/ui/CategoryIcon";
import { dayTotals, sharesOf, type StoryBill } from "@/lib/story";

interface Member { id: string; name: string; username?: string; avatarUrl: string | null; avatarKey?: string | null }

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * A day told as a story, as bills to check before saving. The top says what the day means
 * for everyone; each card is one bill. Nothing is saved until "Save all", and a bill
 * without a payer must be answered first: the app asks, it doesn't guess.
 */
export default function StoryReview({
  bills, setBills, members, meId, unclear, saving, error, onSave, onStartOver,
}: {
  bills: StoryBill[];
  setBills: (fn: (b: StoryBill[]) => StoryBill[]) => void;
  members: Member[];
  meId: string;
  unclear: string[];
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onStartOver: () => void;
}) {
  const people = [...members].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
  const first = (id: string) => (id === meId ? "You" : members.find((m) => m.id === id)?.name.split(" ")[0] ?? "Someone");
  const person = (id: string) => members.find((m) => m.id === id) ?? { id, name: "?", avatarUrl: null };
  const update = (key: string, fn: (b: StoryBill) => StoryBill) => setBills((bs) => bs.map((b) => (b.key === key ? fn(b) : b)));

  const live = bills.filter((b) => !b.skip);
  const toGroup = live.filter((b) => !b.toPersonal);
  const toMine = live.filter((b) => b.toPersonal);
  const waiting = toGroup.filter((b) => !b.paidBy).length;
  const day = dayTotals(bills);
  const order = people.map((m) => m.id).filter((id) => day.people[id] && Math.abs(day.people[id].net) >= 0.01);

  const sentence = (b: StoryBill) => {
    if (b.sharedBy.length === 1) {
      const who = first(b.sharedBy[0]);
      return b.paidBy && b.paidBy !== b.sharedBy[0]
        ? `${first(b.paidBy)} paid for ${who === "You" ? "your" : `${who}'s`} own buy`
        : `${who === "You" ? "Your" : `${who}'s`} own buy · nobody owes anything`;
    }
    const s = sharesOf(b);
    const everyone = b.sharedBy.length === members.length;
    const split = everyone ? "split between everyone" : `split between ${b.sharedBy.map(first).join(", ").replace(/, ([^,]*)$/, " and $1")}`;
    const extra = b.extras.length
      ? ` · ${b.extras.map((e) => `${first(e.userId)} +${money(e.amount)}${e.what ? ` ${e.what}` : ""}`).join(", ")}`
      : ` · ${money(s[b.sharedBy[0]])} each`;
    return `${b.paidBy ? `${first(b.paidBy)} paid` : "Who paid?"} · ${split}${extra}`;
  };

  return (
    <div className="space-y-4 pb-32">
      {/* What the day means */}
      <section className="rounded-[24px] bg-[var(--paper)] border border-[var(--hairline)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="px-5 pt-4 pb-3 bg-[var(--accent-subtle)]">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">Your day</p>
          <p className="text-[24px] font-black tabular-nums leading-tight text-[var(--text-primary)]">
            {toGroup.length} {toGroup.length === 1 ? "bill" : "bills"} · {money(day.total)}
          </p>
          <p className="text-[12.5px] text-[var(--text-secondary)]">
            {toMine.length > 0 && <>{toMine.length} to your own spending · </>}
            {waiting > 0 ? <b className="text-[var(--warn)]">{waiting} {waiting === 1 ? "needs" : "need"} an answer below</b> : "Check each bill, then save."}
          </p>
        </div>
        {order.length > 0 && (
          <div className="px-5 py-3 space-y-2">
            {order.map((id) => {
              const n = day.people[id].net;
              const up = n > 0;
              return (
                <div key={id} className="flex items-center gap-3">
                  <span className="w-8 h-8 flex-shrink-0 flex items-center justify-center"><MemberAvatar person={person(id)} size={30} /></span>
                  <span className="flex-1 text-[14px] font-semibold">
                    {first(id)} {up ? (id === meId ? "get back" : "gets back") : id === meId ? "owe" : "owes"}
                  </span>
                  <span className={`text-[15px] font-extrabold tabular-nums flex items-center gap-1 ${up ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
                    {up ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}{money(Math.abs(n))}
                  </span>
                </div>
              );
            })}
            <p className="text-[11.5px] text-[var(--text-muted)] pt-1">For this day only, added to the group&apos;s balances when you save.</p>
          </div>
        )}
      </section>

      {unclear.length > 0 && (
        <div className="p-3.5 rounded-[16px] bg-[var(--paper)] border border-[var(--hairline)] text-[12.5px] text-[var(--text-secondary)] space-y-1">
          {unclear.map((u) => <p key={u} className="flex gap-2"><AlertTriangle size={14} className="text-[var(--accent)] flex-shrink-0 mt-0.5" /> {u}</p>)}
        </div>
      )}

      {bills.map((b, i) => {
        const needsPayer = !b.paidBy && !b.toPersonal && !b.skip;
        const ownMine = b.sharedBy.length === 1 && b.sharedBy[0] === meId && (b.paidBy === meId || !b.paidBy);
        const s = sharesOf(b);
        return (
          <section
            key={b.key}
            className={`rounded-[22px] border-2 overflow-hidden transition-opacity ${b.skip ? "opacity-50" : ""}`}
            style={{
              borderColor: needsPayer ? "color-mix(in srgb, var(--warn) 55%, transparent)" : "var(--hairline)",
              background: needsPayer ? "color-mix(in srgb, var(--warn) 6%, var(--paper))" : "var(--paper)",
            }}
          >
            <div className="px-4 pt-3.5 flex items-start gap-3">
              <span className="mt-0.5 flex-shrink-0"><CategoryIcon category={b.category} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Bill {i + 1}</p>
                <input
                  value={b.description}
                  onChange={(e) => update(b.key, (x) => ({ ...x, description: e.target.value.slice(0, 60) }))}
                  className="w-full bg-transparent text-[16.5px] font-extrabold outline-none border-b-2 border-transparent focus:border-[var(--accent)]"
                  aria-label={`Bill ${i + 1} name`}
                />
              </div>
              <label className="flex items-center gap-0.5 flex-shrink-0 h-10 px-2.5 rounded-[12px] bg-[var(--paper-dim)] focus-within:ring-2 focus-within:ring-[var(--accent)]">
                <span className="text-[var(--text-muted)] font-bold text-[14px]">₹</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={b.amount || ""}
                  onChange={(e) => update(b.key, (x) => ({ ...x, amount: Math.max(0, parseFloat(e.target.value) || 0) }))}
                  className="w-[76px] bg-transparent text-right text-[17px] font-black tabular-nums outline-none"
                  aria-label={`Bill ${i + 1} amount`}
                />
              </label>
            </div>
            {b.quote && <p className="px-4 mt-1 text-[12px] italic text-[var(--text-muted)] leading-snug">&ldquo;{b.quote}&rdquo;</p>}

            {!b.skip && (
              <div className="px-4 pt-3 pb-4 space-y-3">
                {!b.toPersonal && <p className="text-[13.5px] font-bold text-[var(--text-primary)] leading-snug">{sentence(b)}</p>}

                {ownMine && (
                  <div className="grid grid-cols-2 p-1 rounded-[14px] bg-[var(--paper-dim)]" role="radiogroup" aria-label="Where should this go?">
                    {([[false, "Keep in group"], [true, "My spending"]] as const).map(([v, label]) => (
                      <button
                        key={label}
                        role="radio"
                        aria-checked={!!b.toPersonal === v}
                        onClick={() => update(b.key, (x) => ({ ...x, toPersonal: v, paidBy: x.paidBy ?? meId }))}
                        className={`h-9 rounded-[10px] text-[13px] font-bold flex items-center justify-center gap-1.5 ${!!b.toPersonal === v ? "bg-[var(--paper)] shadow-sm text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
                      >
                        {v && <Wallet size={14} />}{label}
                      </button>
                    ))}
                  </div>
                )}
                {b.toPersonal && <p className="text-[12.5px] text-[var(--text-secondary)]">Goes to your Personal spending, not the group. Nobody else sees it.</p>}

                {!b.toPersonal && (
                  <>
                    {/* Who paid */}
                    <div>
                      {needsPayer && (
                        <p className="mb-2 text-[13px] font-bold text-[var(--warn)] flex items-center gap-1.5"><AlertTriangle size={14} /> {b.question || "Who paid?"}</p>
                      )}
                      <p className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Paid by</p>
                      <div className="flex flex-wrap gap-1.5">
                        {[...people].sort((x, y) => Number(b.sharedBy.includes(y.id)) - Number(b.sharedBy.includes(x.id))).map((m) => {
                          const on = b.paidBy === m.id;
                          return (
                            <button
                              key={m.id}
                              onClick={() => update(b.key, (x) => ({ ...x, paidBy: m.id }))}
                              aria-pressed={on}
                              className={`h-9 pl-1 pr-3 rounded-full flex items-center gap-1.5 text-[13px] font-bold border-2 ${on ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : needsPayer ? "border-[var(--warn)]/40 bg-[var(--paper)]" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}
                            >
                              <span className="w-7 h-7 flex-shrink-0 flex items-center justify-center"><MemberAvatar person={m} size={28} dim={!on && !needsPayer} /></span>
                              {first(m.id)}
                              {on && <Check size={13} strokeWidth={3} className="text-[var(--accent)]" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Who shares */}
                    <div>
                      <p className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Shared by</p>
                      <div className="flex flex-wrap gap-1.5">
                        {people.map((m) => {
                          const on = b.sharedBy.includes(m.id);
                          return (
                            <button
                              key={m.id}
                              onClick={() => update(b.key, (x) => {
                                const sharedBy = on ? x.sharedBy.filter((u) => u !== m.id) : [...x.sharedBy, m.id];
                                return sharedBy.length === 0 ? x : { ...x, sharedBy, extras: x.extras.filter((e) => sharedBy.includes(e.userId)) };
                              })}
                              aria-pressed={on}
                              className={`h-9 pl-1 pr-3 rounded-full flex items-center gap-1.5 text-[13px] font-bold border-2 ${on ? "border-[var(--positive)] bg-[var(--positive)]/10" : "border-[var(--hairline)] text-[var(--text-muted)]"}`}
                            >
                              <span className="w-7 h-7 flex-shrink-0 flex items-center justify-center"><MemberAvatar person={m} size={28} dim={!on} /></span>
                              {first(m.id)}
                              {on && <span className="tabular-nums text-[12px] text-[var(--text-secondary)]">{money(s[m.id] ?? 0)}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="px-4 py-2 border-t border-[var(--hairline)] flex justify-end">
              <button
                onClick={() => update(b.key, (x) => ({ ...x, skip: !x.skip }))}
                className="text-[12.5px] font-bold text-[var(--text-secondary)] flex items-center gap-1.5 h-8 px-2"
              >
                {b.skip ? <><Undo2 size={14} /> Include this bill</> : "Leave this one out"}
              </button>
            </div>
          </section>
        );
      })}

      {error && <p className="text-[13px] font-semibold text-[var(--negative)] p-3 rounded-[14px] bg-[var(--negative)]/10">{error}</p>}

      {/* Save */}
      <div className="app-fixed-x fixed bottom-0 inset-x-0 z-30 bg-[var(--ink)]/95 backdrop-blur-md border-t border-[var(--hairline)] px-4 pt-3 pb-[max(14px,env(safe-area-inset-bottom))]">
        <div className="max-w-md mx-auto">
          <button
            onClick={onSave}
            disabled={saving || waiting > 0 || live.length === 0}
            className="w-full h-14 rounded-[16px] bg-[var(--accent)] text-white text-[16px] font-extrabold flex items-center justify-center gap-2 disabled:opacity-45 active:scale-[0.99] transition-transform"
          >
            {saving ? <><Loader2 size={18} className="animate-spin" /> Saving…</>
              : waiting > 0 ? `Answer ${waiting} ${waiting === 1 ? "question" : "questions"} to save`
              : <><CheckCircle2 size={18} /> Save {live.length === 1 ? "it" : `all ${live.length}`}</>}
          </button>
          <button onClick={onStartOver} className="w-full h-9 mt-1 text-[13px] font-bold text-[var(--text-secondary)]">Start over</button>
        </div>
      </div>
    </div>
  );
}
