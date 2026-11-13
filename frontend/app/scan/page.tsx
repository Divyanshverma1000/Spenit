"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, ChevronLeft, ChevronRight, User as UserIcon } from "lucide-react";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useGroups } from "@/lib/queries";
import { colorFor } from "@/lib/avatar";
import BottomNav from "@/components/BottomNav";
import MemberAvatar from "@/components/ui/MemberAvatar";

/**
 * Home → Scan bill: who is this for? A group opens its scanner (bills, receipts, orders,
 * payments, read item by item); "Just me" scans into your own spending.
 * Replaces the early one-line receipt reader (CAPTURE_PLAN.md).
 */
export default function ScanChooserPage() {
  const authed = useRequireAuth();
  const router = useRouter();
  const { data: groups, isPending } = useGroups();
  if (!authed) return null;

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] text-[var(--text-primary)] page-content safe-area-pb max-w-md mx-auto">
        <header className="px-4 pt-12 pb-2 flex items-center gap-2">
          <button onClick={() => router.back()} className="p-2 -ml-1 text-[var(--text-secondary)]" aria-label="Back"><ChevronLeft size={22} /></button>
          <h1 className="text-[20px] font-extrabold">Scan a bill</h1>
        </header>
        <div className="px-5 pb-10">
          <div className="flex items-center gap-3 p-4 rounded-[20px] bg-[var(--accent-subtle)] mb-5">
            <span className="w-11 h-11 rounded-[14px] bg-[var(--accent)] text-white flex items-center justify-center flex-shrink-0"><Camera size={21} /></span>
            <p className="text-[13.5px] text-[var(--text-primary)] leading-snug">
              Restaurant bills, receipts, order screenshots, UPI payments, rides and tickets. Who is it for?
            </p>
          </div>

          <p className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2 px-1">A group</p>
          {isPending ? (
            <div className="flex justify-center py-8"><div className="spinner" /></div>
          ) : !groups || groups.length === 0 ? (
            <Link href="/groups/new" className="block p-4 rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] text-[14px] text-[var(--text-secondary)]">
              No groups yet. <b className="text-[var(--accent)]">Create one</b> to split a bill.
            </Link>
          ) : (
            <div className="space-y-2">
              {groups.map((g) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}/import`}
                  className="flex items-center gap-3 p-3.5 rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] active:scale-[0.99] transition-transform"
                >
                  <span
                    className="w-10 h-10 rounded-[13px] flex items-center justify-center text-white font-black flex-shrink-0"
                    style={{ background: `linear-gradient(135deg, ${colorFor(g.id)}, ${colorFor(g.id + "x")})` }}
                  >
                    {g.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-bold truncate">{g.name}</span>
                    <span className="flex items-center mt-1 pl-1">
                      {(g.members ?? []).slice(0, 4).map((m, k) => (
                        <span key={m.id} className="relative -ml-1 flex rounded-full ring-2 ring-[var(--paper)]" style={{ zIndex: 4 - k }}>
                          <MemberAvatar person={m} size={18} plain />
                        </span>
                      ))}
                      <span className="ml-1.5 text-[11.5px] text-[var(--text-muted)]">{g.memberCount} people</span>
                    </span>
                  </span>
                  <ChevronRight size={18} className="text-[var(--text-muted)]" />
                </Link>
              ))}
            </div>
          )}

          <p className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)] mt-6 mb-2 px-1">Not shared</p>
          <Link
            href="/personal?scan=1"
            className="flex items-center gap-3 p-3.5 rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] active:scale-[0.99] transition-transform"
          >
            <span className="w-10 h-10 rounded-[13px] bg-[var(--paper-dim)] text-[var(--text-secondary)] flex items-center justify-center flex-shrink-0"><UserIcon size={20} /></span>
            <span className="flex-1">
              <span className="block text-[15px] font-bold">Just me</span>
              <span className="block text-[12px] text-[var(--text-secondary)]">Goes to your own spending</span>
            </span>
            <ChevronRight size={18} className="text-[var(--text-muted)]" />
          </Link>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
