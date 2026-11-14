"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bell, Bot, Camera, Check, ChevronRight, Key, Receipt, Search, ArrowRightLeft, Users, Wallet, X, UserPlus, Sparkles,
} from "lucide-react";
import { BackClose } from "@/lib/backClose";
import { photoSrc } from "@/lib/avatar";
import { ago } from "./AdminDashboard";

export type Stage = "hooked" | "new" | "regular" | "drifting" | "quiet" | "never";

export interface Person {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  joinedAt: string;
  lastSeenAt: string | null;
  cameVia: { group: string; by: string; claimed: boolean } | null;
  stage: Stage;
  usefulness: number;
  activeAgo: number[];
  activeDaysTotal: number;
  groups: { name: string; members: number; mine: boolean }[];
  counts: {
    bills: number; imports: number; payments: number; personal: number; moneyAdded: number; lastBillAt: string | null;
    scans30d: number; chats30d: number; aiCalls30d: number;
  };
  setup: { push: boolean; ownKey: boolean; extraKeys: number };
}
export interface PeopleData {
  generatedAt: string;
  people: Person[];
  inviters: { name: string; people: number; active: number }[];
}

const STAGE: Record<Stage, { label: string; color: string; note: string }> = {
  hooked: { label: "Hooked", color: "var(--positive)", note: "Used it on 4+ days in the last 2 weeks" },
  new: { label: "New", color: "var(--info)", note: "Joined this week" },
  regular: { label: "Regular", color: "var(--accent)", note: "Came back this week" },
  drifting: { label: "Drifting", color: "#F97316", note: "Last seen 1–3 weeks ago" },
  quiet: { label: "Quiet", color: "var(--text-muted)", note: "Not seen for 3+ weeks" },
  never: { label: "Tried once", color: "var(--text-muted)", note: "Signed up, didn't come back" },
};
const ORDER: Stage[] = ["hooked", "new", "regular", "drifting", "quiet", "never"];
const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const date = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function Avatar({ p, size = 40 }: { p: Person; size?: number }) {
  const initials = p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const src = photoSrc(p.avatarUrl);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="rounded-full object-cover flex-shrink-0" style={{ width: size, height: size }} />
  ) : (
    <span className="rounded-full flex items-center justify-center font-extrabold flex-shrink-0 bg-[var(--accent-subtle)] text-[var(--accent)]" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials || "?"}
    </span>
  );
}

function StageBadge({ s }: { s: Stage }) {
  const c = STAGE[s].color;
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
      {STAGE[s].label}
    </span>
  );
}

/** One square per day, oldest left; filled when they used Spenit that day. */
function Days({ activeAgo, days, size = 7, gap = 2 }: { activeAgo: number[]; days: number; size?: number; gap?: number }) {
  const on = new Set(activeAgo);
  return (
    <span className="flex" style={{ gap }} aria-label={`Active ${activeAgo.filter((d) => d < days).length} of the last ${days} days`}>
      {Array.from({ length: days }, (_, i) => days - 1 - i).map((d) => (
        <span key={d} className="rounded-[2px]" style={{ width: size, height: size, background: on.has(d) ? "var(--positive)" : "var(--paper-dim)" }} />
      ))}
    </span>
  );
}

/**
 * Admin → People: who the first users are, how they found Spenit, whether they keep
 * coming back, and what they actually use. Counts only, never bill contents.
 */
export function AdminPeople({ data }: { data: PeopleData }) {
  const [stage, setStage] = useState<Stage | "all">("all");
  const [sort, setSort] = useState<"useful" | "seen" | "new">("useful");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Person | null>(null);
  const ps = data.people;

  const counts = useMemo(() => Object.fromEntries(ORDER.map((s) => [s, ps.filter((p) => p.stage === s).length])) as Record<Stage, number>, [ps]);
  const usefulPct = ps.length ? Math.round(((counts.hooked + counts.regular) / ps.length) * 100) : 0;
  const viaInvite = ps.filter((p) => p.cameVia).length;

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ps
      .filter((p) => stage === "all" || p.stage === stage)
      .filter((p) => !t || p.name.toLowerCase().includes(t) || (p.email ?? "").toLowerCase().includes(t))
      .sort((a, b) =>
        sort === "useful" ? b.usefulness - a.usefulness
        : sort === "new" ? b.joinedAt.localeCompare(a.joinedAt)
        : (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));
  }, [ps, stage, sort, q]);

  return (
    <div className="space-y-5">
      {/* The headline: are people finding it useful? */}
      <section className="rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] p-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Finding it useful</p>
        <p className="mt-1 text-[26px] font-black tabular-nums leading-tight">
          {counts.hooked + counts.regular} <span className="text-[15px] font-bold text-[var(--text-secondary)]">of {ps.length} people · {usefulPct}%</span>
        </p>
        <p className="text-[12.5px] text-[var(--text-secondary)] mt-0.5">
          {counts.hooked} hooked (4+ days in 2 weeks) and {counts.regular} came back this week. {viaInvite} joined through a friend&rsquo;s group.
        </p>
        <div className="mt-3 h-2.5 rounded-full overflow-hidden flex bg-[var(--paper-dim)]" aria-hidden>
          {ORDER.map((s) => <span key={s} style={{ width: `${ps.length ? (counts[s] / ps.length) * 100 : 0}%`, background: STAGE[s].color }} />)}
        </div>
      </section>

      {data.inviters.length > 0 && (
        <section>
          <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Brought people in</h2>
          <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4">
            {data.inviters.map((i) => (
              <div key={i.name} className="flex-shrink-0 rounded-[14px] bg-[var(--paper)] border border-[var(--hairline)] px-3.5 py-2.5">
                <p className="text-[13.5px] font-bold flex items-center gap-1.5"><UserPlus size={14} className="text-[var(--accent)]" /> {i.name}</p>
                <p className="text-[12px] text-[var(--text-secondary)]">brought {i.people} · {i.active} still using it</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filters */}
      <section className="space-y-2.5">
        <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4">
          {(["all", ...ORDER] as const).map((s) => {
            const n = s === "all" ? ps.length : counts[s];
            if (s !== "all" && n === 0) return null;
            const on = stage === s;
            return (
              <button
                key={s}
                onClick={() => setStage(s)}
                className={`h-9 px-3.5 rounded-full text-[13px] font-bold whitespace-nowrap border-2 flex-shrink-0 ${on ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]" : "border-[var(--hairline)] text-[var(--text-secondary)]"}`}
              >
                {s === "all" ? "Everyone" : STAGE[s].label} · {n}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <label className="flex-1 min-w-0 h-10 flex items-center gap-2 px-3 rounded-[12px] bg-[var(--paper)] border border-[var(--hairline)]">
            <Search size={15} className="text-[var(--text-muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" className="flex-1 min-w-0 bg-transparent text-[15px] outline-none" />
          </label>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-10 px-2.5 rounded-[12px] bg-[var(--paper)] border border-[var(--hairline)] text-[13px] font-bold" aria-label="Sort">
            <option value="useful">Most engaged</option>
            <option value="seen">Last seen</option>
            <option value="new">Newest</option>
          </select>
        </div>
      </section>

      {/* People */}
      <section className="rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] divide-y divide-[var(--hairline)] overflow-hidden">
        {list.length === 0 && <p className="p-5 text-[14px] text-[var(--text-secondary)] text-center">Nobody here yet.</p>}
        {list.map((p) => (
          <button key={p.id} onClick={() => setOpen(p)} className="w-full p-3.5 flex items-center gap-3 text-left active:bg-[var(--paper-dim)]">
            <Avatar p={p} />
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-2">
                <span className="font-bold text-[15px] truncate">{p.name}</span>
                <StageBadge s={p.stage} />
              </span>
              <span className="block text-[12px] text-[var(--text-secondary)] truncate">
                {p.lastSeenAt ? `seen ${ago(p.lastSeenAt)}` : "never seen"} · {p.counts.bills} bills · {p.counts.scans30d} scans · {p.counts.chats30d} questions
              </span>
              <span className="mt-1.5 flex items-center gap-2">
                <Days activeAgo={p.activeAgo} days={14} size={6} />
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums">{p.activeAgo.filter((d) => d < 14).length}/14 days</span>
              </span>
            </span>
            <span className="text-right flex-shrink-0">
              <span className="block text-[18px] font-black tabular-nums leading-none">{p.usefulness}</span>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mt-0.5">score</span>
            </span>
            <ChevronRight size={16} className="text-[var(--text-muted)] -ml-1" />
          </button>
        ))}
      </section>
      <p className="text-[11.5px] text-[var(--text-muted)] text-center">
        Score 0–100 from days they came back, bills added, scans, settle-ups, groups and questions asked. Counts only, never what&rsquo;s on anyone&rsquo;s bills.
      </p>

      {open && <PersonSheet p={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PersonSheet({ p, onClose }: { p: Person; onClose: () => void }) {
  const c = p.counts;
  const used: { Icon: typeof Users; label: string; detail: string; on: boolean }[] = [
    { Icon: Users, label: "Groups", detail: p.groups.length ? p.groups.map((g) => `${g.name} (${g.members})${g.mine ? " · created" : ""}`).join(", ") : "None yet", on: p.groups.length > 0 },
    { Icon: Receipt, label: "Added bills", detail: c.bills ? `${c.bills} bills · ${inr(c.moneyAdded)}${c.lastBillAt ? ` · last ${ago(c.lastBillAt)}` : ""}` : "Not yet", on: c.bills > 0 },
    { Icon: Camera, label: "Scanned orders and bills", detail: `${c.imports} saved · ${c.scans30d} ${c.scans30d === 1 ? "screenshot" : "screenshots"} read in 30 days`, on: c.imports > 0 || c.scans30d > 0 },
    { Icon: ArrowRightLeft, label: "Settled up", detail: c.payments ? `${c.payments} ${c.payments === 1 ? "payment" : "payments"} recorded` : "Not yet", on: c.payments > 0 },
    { Icon: Sparkles, label: "Asked the AI", detail: `${c.chats30d} ${c.chats30d === 1 ? "question" : "questions"} in 30 days`, on: c.chats30d > 0 },
    { Icon: Wallet, label: "Personal spending", detail: c.personal ? `${c.personal} entries` : "Not used", on: c.personal > 0 },
    { Icon: Bell, label: "Notifications", detail: p.setup.push ? "On" : "Off", on: p.setup.push },
    { Icon: Key, label: "Own AI key", detail: p.setup.ownKey ? `Yes${p.setup.extraKeys ? ` + ${p.setup.extraKeys} extra` : ""}` : "Uses Spenit's", on: p.setup.ownKey },
  ];
  const how = p.cameVia
    ? p.cameVia.claimed ? `Picked their name in ${p.cameVia.by}'s group "${p.cameVia.group}"` : `Joined ${p.cameVia.by}'s group "${p.cameVia.group}"`
    : "Signed up on their own";

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
        aria-label={p.name}
        className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-[var(--paper)] rounded-t-[28px] px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--hairline)]" aria-hidden />
        <div className="flex items-start gap-3">
          <Avatar p={p} size={52} />
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-[19px] leading-tight">{p.name}</p>
            {p.email && <p className="text-[12.5px] text-[var(--text-secondary)] truncate selectable">{p.email}</p>}
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <StageBadge s={p.stage} />
              <span className="text-[12px] text-[var(--text-secondary)]">{STAGE[p.stage].note}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 rounded-full text-[var(--text-muted)]" aria-label="Close"><X size={20} /></button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ["Score", String(p.usefulness)],
            ["Days used", `${p.activeDaysTotal}`],
            ["Last seen", p.lastSeenAt ? ago(p.lastSeenAt) : "never"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[14px] bg-[var(--paper-dim)] p-2.5 text-center">
              <p className="text-[17px] font-black tabular-nums leading-tight">{v}</p>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{k}</p>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Last 30 days</p>
          <Days activeAgo={p.activeAgo} days={30} size={8.5} gap={2.5} />
        </div>

        <p className="mt-4 text-[13px] text-[var(--text-secondary)]">
          <b className="text-[var(--text-primary)]">Joined {date(p.joinedAt)}.</b> {how}.
        </p>

        <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">What they use</p>
        <div className="mt-1 divide-y divide-[var(--hairline)]">
          {used.map(({ Icon, label, detail, on }) => (
            <div key={label} className="py-2.5 flex items-start gap-3">
              <span className={`w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 ${on ? "bg-[var(--accent-subtle)] text-[var(--accent)]" : "bg-[var(--paper-dim)] text-[var(--text-muted)]"}`}>
                <Icon size={15} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-bold">{label}</span>
                <span className="block text-[12px] text-[var(--text-secondary)] leading-snug">{detail}</span>
              </span>
              {on && <Check size={16} className="text-[var(--positive)] mt-1" strokeWidth={3} />}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11.5px] text-[var(--text-muted)] flex items-center gap-1.5"><Bot size={13} /> Counts only. Their bills, items and chats stay private.</p>
      </motion.div>
    </div>
  );
}
