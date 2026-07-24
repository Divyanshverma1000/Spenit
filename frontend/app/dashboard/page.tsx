"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { Card } from "@/components/ui/Card";
import { BalanceAmount } from "@/components/ui/BalanceAmount";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { EmptyState } from "@/components/ui/EmptyState";
import { Plus, Users, ChevronRight, TrendingUp, TrendingDown, Check } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface GroupBreakdown {
  groupId: string;
  groupName: string;
  netAmount: string;
  direction: "owed" | "owes" | "settled";
  signedAmount: string;
}
interface CrossGroupBalance {
  netAmount: string;
  direction: "owed" | "owes" | "settled";
  breakdown: GroupBreakdown[];
}

export default function DashboardPage() {
  const authed = useRequireAuth();
  const { user, accessToken } = useAuth();
  const [balance, setBalance] = useState<CrossGroupBalance | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBalance = useCallback(() => {
    if (!accessToken) return;
    fetch(`${API_URL}/balance/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json())
      .then(setBalance)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  // Initial load
  useEffect(() => { loadBalance(); }, [loadBalance]);

  // 30s polling — dashboard balance stays live
  useEffect(() => {
    const interval = setInterval(loadBalance, 30_000);
    return () => clearInterval(interval);
  }, [loadBalance]);

  // Refresh on tab focus
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadBalance(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadBalance]);

  if (!authed) return null;

  const direction = balance?.direction ?? "settled";

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb">
        {/* Header */}
        <div className="px-5 pt-14 pb-4">
          <h1 className="text-[14px] font-[var(--font-body)] text-[var(--text-muted)]">
            Hi, {user?.name?.split(" ")[0] || "there"}
          </h1>
        </div>

        {/* ── Hero balance card ──────────────────────────────────────────────── */}
        <div className="px-5 mb-5">
          <Card 
            accentEdge={direction === "owed" ? "positive" : direction === "owes" ? "negative" : "none"}
            padding="lg"
            className="balance-reveal"
          >
            <SectionLabel>YOUR OVERALL BALANCE</SectionLabel>

            {loading ? (
              <div className="flex items-center gap-3 py-2">
                <div className="spinner w-5 h-5" />
                <span className="text-[var(--text-secondary)] text-sm font-[var(--font-body)]">Calculating...</span>
              </div>
            ) : (
              <>
                <div className="mb-2">
                  <BalanceAmount 
                    variant="hero" 
                    direction={direction} 
                    amount={balance?.netAmount || "0"} 
                  />
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  {direction === "owed" && <TrendingUp size={14} className="text-[var(--positive)]" />}
                  {direction === "owes" && <TrendingDown size={14} className="text-[var(--negative)]" />}
                  <p className={`text-[13px] font-[var(--font-body)] ${
                    direction === "owed" ? "text-[var(--positive)]" : 
                    direction === "owes" ? "text-[var(--negative)]" : 
                    "text-[var(--text-secondary)]"
                  }`}>
                    {direction === "owed"
                      ? "You are owed across all groups"
                      : direction === "owes"
                        ? "You owe across all groups"
                        : "All settled"}
                  </p>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* ── Quick actions ─────────────────────────────────────────────────── */}
        <div className="px-5 mb-6">
          <div className="grid grid-cols-2 gap-[12px]">
            <Link href="/groups/new" className="block outline-none">
              <Card padding="md" className="hover:bg-[var(--paper-dim)] transition-colors h-full flex flex-col justify-center gap-2">
                <Plus size={20} className="text-[var(--text-primary)]" />
                <span className="text-[14px] font-semibold font-[var(--font-body)] text-[var(--text-primary)]">New Group</span>
              </Card>
            </Link>
            <Link href="/groups" className="block outline-none">
              <Card padding="md" className="hover:bg-[var(--paper-dim)] transition-colors h-full flex flex-col justify-center gap-2">
                <div className="flex justify-between items-center w-full">
                  <Users size={20} className="text-[var(--text-primary)]" />
                  <ChevronRight size={16} className="text-[var(--text-muted)]" />
                </div>
                <span className="text-[14px] font-semibold font-[var(--font-body)] text-[var(--text-primary)]">All Groups</span>
              </Card>
            </Link>
          </div>
        </div>

        {/* ── Per-group breakdown ───────────────────────────────────────────── */}
        {balance && balance.breakdown.length > 0 && (
          <div className="px-5">
            <SectionLabel>By Group</SectionLabel>
            <Card padding="none" className="overflow-hidden">
              <div className="flex flex-col">
                {balance.breakdown.map((g, idx) => (
                  <Link 
                    key={g.groupId} 
                    href={`/groups/${g.groupId}`}
                    className={`flex items-center gap-3 p-4 hover:bg-[var(--paper-dim)] transition-colors ${
                      idx !== balance.breakdown.length - 1 ? "border-b border-[var(--border)]" : ""
                    }`}
                  >
                    <div className="h-[36px] w-[36px] rounded-[var(--radius-sm)] bg-[var(--paper-dim)] text-[var(--accent)] flex items-center justify-center text-[16px] font-semibold flex-shrink-0 font-[var(--font-body)]">
                      {g.groupName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-[var(--text-primary)] truncate font-[var(--font-body)]">
                        {g.groupName}
                      </p>
                      <p className="text-[12px] text-[var(--text-secondary)] font-[var(--font-body)]">
                        {g.direction === "settled" ? "Settled" : g.direction === "owed" ? "You are owed" : "You owe"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {g.direction !== "settled" ? (
                        <BalanceAmount 
                          variant="default" 
                          direction={g.direction} 
                          amount={g.netAmount} 
                        />
                      ) : (
                        <Check size={16} className="text-[var(--positive)]" />
                      )}
                      <ChevronRight size={16} className="text-[var(--text-muted)]" />
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* Empty state */}
        {balance && balance.breakdown.length === 0 && !loading && (
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
