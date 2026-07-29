"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { BalanceAmount } from "@/components/ui/BalanceAmount";
import { EmptyState } from "@/components/ui/EmptyState";
import { QuickActions } from "@/components/ui/QuickActions";
import { SettingsList } from "@/components/ui/SettingsList";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { Plus, Users, TrendingUp, TrendingDown, Check } from "lucide-react";

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
  const router = useRouter();
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

  useEffect(() => { loadBalance(); }, [loadBalance]);
  useEffect(() => {
    const interval = setInterval(loadBalance, 30_000);
    return () => clearInterval(interval);
  }, [loadBalance]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadBalance(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadBalance]);

  if (!authed) return null;

  const direction = balance?.direction ?? "settled";
  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb">
        
        {/* ── Greeting Header ──────────────────────────────────────────────── */}
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-6 pt-16 pb-6"
        >
          <h2 className="text-[14px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">
            {today}
          </h2>
          <h1 className="text-[28px] font-bold text-[var(--text-primary)] tracking-tight">
            Hello, {user?.name?.split(" ")[0] || "there"}
          </h1>
        </motion.div>

        {/* ── Hero balance card ──────────────────────────────────────────────── */}
        <div className="px-5 mb-6">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.4, type: "spring", bounce: 0.4 }}
            className={`bg-white rounded-[24px] p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04),0_2px_10px_rgba(0,0,0,0.02)] border border-[rgba(0,0,0,0.02)] relative overflow-hidden flex flex-col gap-2 ${
              direction === "owed" ? "border-l-4 border-l-[var(--positive)]" : 
              direction === "owes" ? "border-l-4 border-l-[var(--negative)]" : 
              ""
            }`}
          >
            <h3 className="text-[12px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Overall Balance</h3>

            {loading ? (
              <div className="flex items-center gap-3 py-2">
                <div className="spinner-sm" />
                <span className="text-[var(--text-secondary)] text-[14px] font-medium">Calculating...</span>
              </div>
            ) : (
              <>
                <div>
                  <BalanceAmount 
                    variant="hero" 
                    direction={direction} 
                    amount={balance?.netAmount || "0"} 
                  />
                </div>
                <div className="flex items-center gap-1.5 inline-flex px-3 py-1.5 rounded-[12px] bg-[var(--ink)] self-start mt-1">
                  {direction === "owed" && <TrendingUp size={14} className="text-[var(--positive)]" />}
                  {direction === "owes" && <TrendingDown size={14} className="text-[var(--negative)]" />}
                  <span className={`text-[12px] font-semibold ${
                    direction === "owed" ? "text-[var(--positive)]" : 
                    direction === "owes" ? "text-[var(--negative)]" : 
                    "text-[var(--text-secondary)]"
                  }`}>
                    {direction === "owed" ? `You are owed across ${balance?.breakdown.length || 0} groups` : direction === "owes" ? `You owe across ${balance?.breakdown.length || 0} groups` : "All settled up"}
                  </span>
                </div>
              </>
            )}
          </motion.div>
        </div>

        {/* ── Quick actions ─────────────────────────────────────────────────── */}
        <div className="px-5 mb-8">
          <QuickActions 
            actions={[
              { label: "New Group", icon: <Plus size={20} />, href: "/groups/new", accent: true },
              { label: "Scan Receipt", icon: <Users size={20} />, href: "/scan" },
              { label: "AI Expense", icon: <TrendingUp size={20} />, href: "/personal/chat" },
              { label: "Join Group", icon: <Check size={20} />, href: "/join/scan" }
            ]}
          />
        </div>

        {/* ── Per-group breakdown (iOS Settings style) ──────────────────────── */}
        {balance && balance.breakdown.length > 0 && (
          <div className="px-5">
            <SettingsList title="By Group">
              {balance.breakdown.map((g) => (
                <SettingsRow 
                  key={g.groupId}
                  href={`/groups/${g.groupId}`}
                  icon={
                    <div className="h-8 w-8 rounded-full bg-[var(--paper-dim)] text-[var(--accent)] flex items-center justify-center text-[12px] font-bold">
                      {g.groupName.charAt(0).toUpperCase()}
                    </div>
                  }
                  label={g.groupName}
                  value={
                    g.direction === "settled" ? (
                      <span className="text-[var(--positive)] flex items-center gap-1">
                        <Check size={14} /> Settled
                      </span>
                    ) : (
                      <BalanceAmount variant="compact" direction={g.direction} amount={g.netAmount} />
                    )
                  }
                />
              ))}
            </SettingsList>
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
