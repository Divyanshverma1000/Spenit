"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { GroupListItem } from "@/lib/queries";
import BottomNav from "@/components/BottomNav";
import { EmptyState } from "@/components/ui/EmptyState";
import MemberAvatar from "@/components/ui/MemberAvatar";
import { colorFor } from "@/lib/avatar";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Plus, QrCode, ScanLine, Sparkles, Check, ShoppingBag } from "lucide-react";

interface GroupBreakdown {
  groupId: string;
  groupName: string;
  netAmount: string;
  direction: "owed" | "owes" | "settled";
  signedAmount: string;
}
export interface CrossGroupBalance {
  netAmount: string;
  direction: "owed" | "owes" | "settled";
  breakdown: GroupBreakdown[];
}

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

/** Greeting and its art for the time of day. */
function greeting(d: Date): { text: string; art: string } {
  const h = d.getHours();
  if (h < 5) return { text: "Up late", art: "night" };
  if (h < 12) return { text: "Good morning", art: "morning" };
  if (h < 17) return { text: "Good afternoon", art: "afternoon" };
  if (h < 22) return { text: "Good evening", art: "evening" };
  return { text: "Good night", art: "night" };
}

const ACTIONS = [
  { label: "New group", href: "/groups/new", icon: Plus, tint: "#F59E0B" },
  { label: "Scan bill", href: "/scan", icon: ScanLine, tint: "#14B8A6" },
  { label: "Ask AI", href: "/personal/chat", icon: Sparkles, tint: "#8B5CF6" },
  { label: "Join group", href: "/join/scan", icon: QrCode, tint: "#F43F5E" },
];

export function DashboardView({
  user, balance, groups, loading,
}: {
  user: { id: string; name: string; avatarUrl: string | null } | null;
  balance: CrossGroupBalance | undefined;
  groups: GroupListItem[] | undefined;
  loading: boolean;
}) {
  const now = new Date();
  const hello = greeting(now);
  const direction = balance?.direction ?? "settled";
  const breakdown = balance?.breakdown ?? [];
  const owedToMe = breakdown.filter((g) => g.direction === "owed").reduce((a, g) => a + (parseFloat(g.netAmount) || 0), 0);
  const iOwe = breakdown.filter((g) => g.direction === "owes").reduce((a, g) => a + (parseFloat(g.netAmount) || 0), 0);
  const openGroups = breakdown.filter((g) => g.direction !== "settled").length;
  const net = parseFloat(balance?.netAmount ?? "0") || 0;
  const groupById = new Map<string, GroupListItem>((groups ?? []).map((g) => [g.id, g]));
  // "Split an order" goes straight to the import when there's only one group to pick.
  const orderHref = groups && groups.length === 1 ? `/groups/${groups[0].id}/import` : "/groups";

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb overflow-x-hidden max-w-md mx-auto">
        {/* ── Greeting ─────────────────────────────────────────────────────── */}
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-5 pt-14 pb-5 flex items-center gap-3"
        >
          {/* time-of-day art in a soft glowing tile */}
          <span className="relative flex-shrink-0 w-[52px] h-[52px] rounded-[18px] flex items-center justify-center bg-[var(--paper)] border border-[var(--hairline)] overflow-hidden">
            <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(245,158,11,0.28),transparent_70%)]" />
            <motion.img
              src={`/illustrations/greet-${hello.art}.webp`}
              alt=""
              aria-hidden
              className="relative w-[40px] h-[40px] object-contain"
              animate={{ y: [0, -2.5, 0], rotate: [0, 3, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-[var(--text-secondary)]">
              {hello.text} · {now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
            </p>
            <h1 className="text-[26px] font-bold text-[var(--text-primary)] tracking-tight leading-tight truncate">
              Hi,{" "}
              <span className="bg-gradient-to-r from-[#F59E0B] via-[#FB923C] to-[#F43F5E] bg-clip-text text-transparent">
                {user?.name?.split(" ")[0] || "there"}
              </span>
            </h1>
          </div>
          {user && (
            <Link
              href="/profile"
              aria-label="Your profile"
              className="flex-shrink-0 flex rounded-full p-[2px] active:scale-95 transition-transform"
              style={{ background: "conic-gradient(from 200deg, #F59E0B, #FB7185, #F59E0B 60%, #FCD34D, #F59E0B)" }}
            >
              <span className="flex rounded-full p-[2px] bg-[var(--ink)]">
                <MemberAvatar person={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }} size={42} />
              </span>
            </Link>
          )}
        </motion.header>

        {/* ── Balance hero ─────────────────────────────────────────────────── */}
        <div className="px-5 mb-6">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.45, type: "spring", bounce: 0.3 }}
            className="relative overflow-hidden rounded-[28px] p-5 pb-4 text-white shadow-[0_18px_40px_-18px_rgba(245,158,11,0.55)]"
            style={{ background: "radial-gradient(120% 90% at 100% 0%, #3B2A12 0%, #1C1A17 45%, #121316 100%)" }}
          >
            {/* soft light */}
            <div className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full bg-[#F59E0B] opacity-25 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-16 w-48 h-48 rounded-full bg-[#14B8A6] opacity-15 blur-3xl" />
            {/* art */}
            <motion.img
              src="/illustrations/home-hero.webp"
              alt=""
              aria-hidden
              initial={{ opacity: 0, scale: 0.9, rotate: -4 }}
              animate={{ opacity: 1, scale: 1, rotate: 0, y: [0, -4, 0] }}
              transition={{ delay: 0.2, duration: 0.6, y: { duration: 5, repeat: Infinity, ease: "easeInOut" } }}
              className="pointer-events-none absolute -right-3 -top-1 w-[126px] h-[126px] object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.35)] [mask-image:linear-gradient(to_bottom,#000_78%,transparent)]"
            />

            <div className="relative pr-[110px]">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/60">
                {direction === "owed" ? "You're owed" : direction === "owes" ? "You owe" : "Your balance"}
              </p>
              {loading ? (
                <div className="h-[52px] flex items-center gap-2 text-white/70 text-[14px]"><div className="spinner-sm" /> Working it out…</div>
              ) : (
                <p
                  className={`mt-1 font-black tracking-tight tabular-nums leading-none ${inr(Math.abs(net)).length > 9 ? "text-[30px]" : "text-[42px]"} ${
                    direction === "owed" ? "text-[#4ADE80]" : direction === "owes" ? "text-[#FB7185]" : "text-white"
                  }`}
                >
                  {inr(Math.abs(net))}
                </p>
              )}
              <p className="mt-2 text-[13px] font-medium text-white/70">
                {direction === "settled"
                  ? "All square. Nice and tidy."
                  : `Across ${openGroups} ${openGroups === 1 ? "group" : "groups"}`}
              </p>
            </div>

            {/* owed / owe split */}
            <div className="relative mt-5 grid grid-cols-2 gap-2">
              <div className={`rounded-2xl border px-3 py-2.5 backdrop-blur-sm transition-opacity ${owedToMe > 0.004 ? "bg-white/[0.07] border-white/10" : "bg-white/[0.03] border-white/[0.06] opacity-70"}`}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/60">
                  <span className="w-5 h-5 rounded-full bg-[#4ADE80]/15 text-[#4ADE80] flex items-center justify-center"><ArrowDownLeft size={12} strokeWidth={3} /></span>
                  Coming to you
                </div>
                {owedToMe > 0.004 ? (
                  <div className="mt-1 text-[17px] font-bold tabular-nums">{inr(owedToMe)}</div>
                ) : (
                  <div className="mt-1 h-[25.5px] flex items-center gap-1 text-[13px] font-semibold text-white/55"><Check size={13} strokeWidth={3} /> Nothing due</div>
                )}
              </div>
              <div className={`rounded-2xl border px-3 py-2.5 backdrop-blur-sm transition-opacity ${iOwe > 0.004 ? "bg-white/[0.07] border-white/10" : "bg-white/[0.03] border-white/[0.06] opacity-70"}`}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/60">
                  <span className="w-5 h-5 rounded-full bg-[#FB7185]/15 text-[#FB7185] flex items-center justify-center"><ArrowUpRight size={12} strokeWidth={3} /></span>
                  You pay
                </div>
                {iOwe > 0.004 ? (
                  <div className="mt-1 text-[17px] font-bold tabular-nums">{inr(iOwe)}</div>
                ) : (
                  <div className="mt-1 h-[25.5px] flex items-center gap-1 text-[13px] font-semibold text-white/55"><Check size={13} strokeWidth={3} /> Nothing to pay</div>
                )}
              </div>
            </div>
          </motion.section>
        </div>

        {/* ── Quick actions ────────────────────────────────────────────────── */}
        <nav className="px-5 mb-6 grid grid-cols-4 gap-2.5" aria-label="Quick actions">
          {ACTIONS.map(({ label, href, icon: Icon, tint }, i) => (
            <motion.div key={href} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.04 }}>
              <Link href={href} className="group flex flex-col items-center gap-2 outline-none">
                <motion.span
                  whileTap={{ scale: 0.9 }}
                  className="w-full aspect-square max-w-[72px] rounded-[22px] flex items-center justify-center border border-[var(--hairline)] bg-[var(--paper)] shadow-[0_4px_14px_rgba(0,0,0,0.04)]"
                >
                  <span className="w-11 h-11 rounded-[14px] flex items-center justify-center" style={{ backgroundColor: `${tint}1F`, color: tint }}>
                    <Icon size={22} strokeWidth={2.4} />
                  </span>
                </motion.span>
                <span className="text-[12px] font-semibold text-[var(--text-primary)] text-center leading-tight">{label}</span>
              </Link>
            </motion.div>
          ))}
        </nav>

        {/* ── Split an order (feature card) ────────────────────────────────── */}
        {groups && groups.length > 0 && (
          <div className="px-5 mb-7">
            <Link
              href={orderHref}
              className="relative flex items-center gap-3 overflow-hidden rounded-[24px] border border-[var(--hairline)] bg-[var(--paper)] p-4 pr-3 active:scale-[0.99] transition-transform"
            >
              <div className="pointer-events-none absolute -left-10 -bottom-12 w-40 h-40 rounded-full bg-[var(--accent)] opacity-[0.12] blur-2xl" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/illustrations/home-orders.webp" alt="" aria-hidden className="relative w-[76px] h-[76px] object-contain flex-shrink-0 -my-1" />
              <div className="relative flex-1 min-w-0">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--accent)]">
                  <ShoppingBag size={12} strokeWidth={2.6} /> Split an order
                </p>
                <p className="text-[15px] font-bold text-[var(--text-primary)] leading-snug mt-0.5">Drop your order screenshots</p>
                <p className="text-[12px] text-[var(--text-secondary)] leading-snug mt-0.5">Blinkit, Zepto, Instamart… we sort who had what.</p>
              </div>
              <ChevronRight size={20} className="relative text-[var(--text-muted)] flex-shrink-0" />
            </Link>
          </div>
        )}

        {/* ── Groups ───────────────────────────────────────────────────────── */}
        {breakdown.length > 0 && (
          <section className="px-5">
            <div className="flex items-baseline justify-between mb-3 px-1">
              <h2 className="text-[13px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Your groups</h2>
              <Link href="/groups" className="text-[13px] font-semibold text-[var(--accent)]">See all</Link>
            </div>
            <div className="space-y-2.5">
              {breakdown.map((g, i) => {
                const info = groupById.get(g.groupId);
                const members = info?.members ?? [];
                const extra = Math.max(0, (info?.memberCount ?? members.length) - Math.min(3, members.length));
                const amt = parseFloat(g.netAmount) || 0;
                return (
                  <motion.div key={g.groupId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.04 }}>
                    <Link
                      href={`/groups/${g.groupId}`}
                      className="flex items-center gap-3 rounded-[22px] border border-[var(--hairline)] bg-[var(--paper)] p-3.5 active:scale-[0.99] transition-transform"
                    >
                      <span
                        className="w-11 h-11 rounded-[14px] flex items-center justify-center text-white text-[17px] font-black flex-shrink-0"
                        style={{ background: `linear-gradient(135deg, ${colorFor(g.groupId)}, ${colorFor(g.groupId + "x")})` }}
                      >
                        {g.groupName.trim().charAt(0).toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[16px] font-bold text-[var(--text-primary)] truncate">{g.groupName}</p>
                        {members.length > 0 ? (
                          <div className="flex items-center mt-1 pl-1.5">
                            {members.slice(0, 3).map((m, k) => (
                              <span key={m.id} className="relative -ml-1.5 flex rounded-full ring-2 ring-[var(--paper)]" style={{ zIndex: 3 - k }}>
                                <MemberAvatar person={m} size={20} plain />
                              </span>
                            ))}
                            {extra > 0 && <span className="ml-1.5 text-[11px] font-semibold text-[var(--text-muted)]">+{extra}</span>}
                          </div>
                        ) : (
                          <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{info ? `${info.memberCount} members` : " "}</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        {g.direction === "settled" ? (
                          <span className="inline-flex items-center gap-1 text-[13px] font-bold text-[var(--positive)]"><Check size={14} strokeWidth={3} /> Settled</span>
                        ) : (
                          <>
                            <p className={`text-[16px] font-bold tabular-nums ${g.direction === "owed" ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>{inr(amt)}</p>
                            <p className="text-[11px] font-medium text-[var(--text-muted)]">{g.direction === "owed" ? "you get back" : "you owe"}</p>
                          </>
                        )}
                      </div>
                      <ChevronRight size={18} className="text-[var(--text-muted)] flex-shrink-0 -mr-1" />
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </section>
        )}

        {/* Empty state */}
        {balance && breakdown.length === 0 && !loading && (
          <div className="px-5">
            <EmptyState
              type="no-groups"
              title="No groups yet"
              description="Create a group and invite your friends"
              action={{ label: "Create First Group", href: "/groups/new" }}
            />
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}
