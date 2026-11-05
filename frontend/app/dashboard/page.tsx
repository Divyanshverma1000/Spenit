"use client";

import { useAuth } from "@/context/AuthContext";
import { useGroups, useMyBalance } from "@/lib/queries";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { DashboardView, type CrossGroupBalance } from "@/components/home/DashboardView";

export default function DashboardPage() {
  const authed = useRequireAuth();
  const { user } = useAuth();
  // Cached + persisted: shows the last known balance instantly, refreshes on focus.
  const { data: balance, isPending } = useMyBalance<CrossGroupBalance>();
  const { data: groups } = useGroups();
  if (!authed) return null;
  return <DashboardView user={user} balance={balance} groups={groups} loading={isPending && !balance} />;
}

