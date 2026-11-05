"use client";

import { API_URL } from "@/lib/api";
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useGroupOverview } from "@/lib/queries";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { Card } from "@/components/ui/Card";
import { BalanceAmount } from "@/components/ui/BalanceAmount";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { PageHeader } from "@/components/ui/PageHeader";
import { ArrowRight } from "lucide-react";
import MemberAvatar from "@/components/ui/MemberAvatar";


export default function GroupBalancePage() {
  const { id: groupId } = useParams<{ id: string }>();
  const authed = useRequireAuth();
  const { user } = useAuth();
  const router = useRouter();

  // Same cached request as the group page, so this screen opens instantly.
  const { data, isPending, isError, error } = useGroupOverview(groupId);
  const balance = data?.balance ?? null;
  const loading = isPending && !data;

  useEffect(() => {
    const status = (error as { status?: number } | null)?.status;
    if (isError && (status === 403 || status === 404)) router.replace("/groups");
  }, [isError, error, router]);

  if (!authed) return null;

  if (loading) return (
    <>
      <main className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--ink)" }}>
        <div className="spinner" />
      </main>
      <BottomNav />
    </>
  );
  if (!balance) return null;

  const { myBalance, memberBalances, simplifiedTransfers } = balance;
  const d = myBalance.direction;
  const edge = d === "owed" ? "positive" : d === "owes" ? "negative" : "none";

  return (
    <>
      <main className="min-h-screen page-content pb-24" style={{ backgroundColor: "var(--ink)" }}>
        <PageHeader 
          title="Balance"
          subtitle={balance.groupName}
          onBack={() => router.back()}
        />

        <div className="px-4 space-y-5">
          <Card accentEdge={edge} padding="lg">
            <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>Your balance</p>
            <BalanceAmount amount={myBalance.netAmount} direction={d} variant="hero" />
            <p className="text-sm mt-2" style={{ color: "var(--text-secondary)" }}>
              {d === "owed" ? "Others owe you this in total" : d === "owes" ? "You owe this in total" : "You're all settled up"}
            </p>
          </Card>

          {memberBalances.filter(m => m.userId !== user?.id).length > 0 && (
            <div>
              <SectionLabel className="mb-2">GROUP MEMBERS</SectionLabel>
              <Card padding="none">
                <div className="flex flex-col">
                  {memberBalances.filter(m => m.userId !== user?.id).map((m, i, arr) => (
                    <div key={m.userId} className="p-3 flex items-center gap-3" style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <MemberAvatar person={{ id: m.userId, name: m.name, avatarUrl: m.avatarUrl, avatarKey: m.avatarKey, isPlaceholder: m.isPlaceholder }} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{m.name}</p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{m.isPlaceholder ? "Not joined yet" : `@${m.username}`}</p>
                      </div>
                      <div className="text-right">
                        <BalanceAmount amount={m.netAmount} direction={m.direction} variant="compact" />
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          {m.direction === "owed" ? "is owed" : m.direction === "owes" ? "owes group" : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {simplifiedTransfers.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionLabel>SIMPLIFIED TRANSFERS</SectionLabel>
                <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{simplifiedTransfers.length} payment{simplifiedTransfers.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="space-y-2">
                {simplifiedTransfers.map((t, i) => (
                  <Card key={i} padding="sm">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium truncate flex-1" style={{ color: t.from === user?.id ? "var(--negative)" : "var(--text-primary)" }}>
                        {t.from === user?.id ? "You" : t.fromName}
                      </span>
                      <ArrowRight className="h-4 w-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} strokeWidth={1.5} />
                      <span className="font-medium truncate flex-1 text-right" style={{ color: t.to === user?.id ? "var(--positive)" : "var(--text-primary)" }}>
                        {t.to === user?.id ? "You" : t.toName}
                      </span>
                    </div>
                    <div className="mt-2 text-center border-t pt-2" style={{ borderColor: "var(--border)" }}>
                      <span className="font-semibold text-lg tabular-nums" style={{ color: "var(--text-primary)", fontFamily: "var(--font-display)" }}>
                        ₹{parseFloat(t.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
              <Link href={`/groups/${groupId}/settle`} className="mt-4 w-full btn-primary py-3 text-sm text-center block rounded-[var(--radius-md)]">
                Settle Up Now
              </Link>
            </div>
          ) : (
            <Card padding="lg" className="text-center">
              <p className="text-lg font-medium mb-1" style={{ color: "var(--positive)" }}>All settled up!</p>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No outstanding balances in this group.</p>
            </Card>
          )}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
