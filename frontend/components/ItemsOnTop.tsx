"use client";

import { Plus, X } from "lucide-react";
import MemberAvatar from "@/components/ui/MemberAvatar";
import { newItem, type ItemSplit, type SpecificItem } from "@/lib/itemSplit";

interface Person { id: string; name: string; avatarUrl: string | null; avatarKey?: string | null }

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * "Items only some had": type the item and its price, tap who had it. Spenit takes those
 * off the bill and splits the rest, so nobody does the dinner maths on a calculator.
 * Used on the story review cards and the manual add-expense form.
 */
export default function ItemsOnTop({
  items, onChange, people, first, split, restCount, compact = false,
}: {
  items: SpecificItem[];
  onChange: (items: SpecificItem[]) => void;
  people: Person[];
  /** "You" / first name */
  first: (id: string) => string;
  split: ItemSplit;
  /** how many people share the rest */
  restCount: number;
  /** tighter spacing inside a story card */
  compact?: boolean;
}) {
  const set = (id: string, patch: Partial<SpecificItem>) => onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const toggle = (it: SpecificItem, uid: string) =>
    set(it.id, { sharedBy: it.sharedBy.includes(uid) ? it.sharedBy.filter((u) => u !== uid) : [...it.sharedBy, uid] });

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Items only some had</p>
        {items.length === 0 && <p className="text-[11.5px] text-[var(--text-muted)]">An extra dessert, a drink, a heater for two</p>}
      </div>

      <div className="space-y-2">
        {items.map((it) => {
          const hasAmount = (parseFloat(it.amount) || 0) > 0;
          const nobody = hasAmount && it.sharedBy.length === 0;
          return (
            <div
              key={it.id}
              className={`rounded-[16px] border ${compact ? "p-2.5" : "p-3"} ${nobody ? "border-[var(--warn)]/50" : "border-[var(--hairline)]"} bg-[var(--paper-dim)]/60`}
            >
              <div className="flex items-center gap-2">
                <input
                  value={it.label}
                  onChange={(e) => set(it.id, { label: e.target.value.slice(0, 40) })}
                  placeholder="Item name"
                  aria-label="Item name"
                  className="flex-1 min-w-0 h-9 px-2.5 rounded-[10px] bg-[var(--paper)] text-[14px] font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-muted)] placeholder:font-medium outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <label className="flex items-center h-9 px-2 rounded-[10px] bg-[var(--paper)] focus-within:ring-2 focus-within:ring-[var(--accent)]">
                  <span className="text-[13px] font-bold text-[var(--text-muted)]">₹</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={it.amount}
                    onChange={(e) => set(it.id, { amount: e.target.value })}
                    placeholder="0"
                    aria-label={`${it.label || "Item"} price`}
                    className="w-[64px] bg-transparent text-right text-[14.5px] font-extrabold tabular-nums text-[var(--text-primary)] outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onChange(items.filter((x) => x.id !== it.id))}
                  className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full text-[var(--text-muted)] active:bg-[var(--paper)]"
                  aria-label={`Remove ${it.label || "item"}`}
                >
                  <X size={16} />
                </button>
              </div>

              <p className={`mt-2 mb-1.5 text-[11.5px] font-semibold ${nobody ? "text-[var(--warn)]" : "text-[var(--text-muted)]"}`}>
                {nobody ? "Tap who had it" : it.sharedBy.length > 1 && hasAmount ? `Who had it · ${money(Math.round((parseFloat(it.amount) / it.sharedBy.length) * 100) / 100)} each` : "Who had it"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {people.map((m) => {
                  const on = it.sharedBy.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggle(it, m.id)}
                      aria-pressed={on}
                      className={`h-8 pl-0.5 pr-2.5 rounded-full flex items-center gap-1.5 text-[12.5px] font-bold border-2 transition-colors ${on ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--text-primary)]" : "border-[var(--hairline)] bg-[var(--paper)] text-[var(--text-muted)]"}`}
                    >
                      <span className="w-6 h-6 flex-shrink-0 flex items-center justify-center"><MemberAvatar person={m} size={24} dim={!on} /></span>
                      {first(m.id)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => onChange([...items, newItem()])}
          className="w-full h-11 rounded-[14px] border-2 border-dashed text-[13.5px] font-bold text-[var(--accent)] flex items-center justify-center gap-1.5 active:scale-[0.99] transition-transform"
          style={{ borderColor: "rgba(245,158,11,0.55)" }}
        >
          <Plus size={16} strokeWidth={2.6} /> Add an item
        </button>
      </div>

      {items.some((it) => (parseFloat(it.amount) || 0) > 0) && (
        <p className={`mt-2 text-[12.5px] font-semibold leading-snug ${split.over ? "text-[var(--negative)]" : "text-[var(--text-secondary)]"}`}>
          {split.over
            ? `Items add up to ${money(split.itemsTotal)}, more than the bill. Check the amounts.`
            : <>Items {money(split.itemsTotal)} · <b className="text-[var(--text-primary)]">{money(split.rest)} left</b>{restCount > 0 ? <> split between {restCount} · {money(split.each)} each</> : " · pick who shares it"}</>}
        </p>
      )}
    </div>
  );
}
