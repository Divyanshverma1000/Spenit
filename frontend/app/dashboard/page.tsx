"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useGroups, useMyBalance } from "@/lib/queries";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { DashboardView, type CrossGroupBalance } from "@/components/home/DashboardView";
import Welcome, { welcomeSeen } from "@/components/home/Welcome";

export default function DashboardPage() {
  const authed = useRequireAuth();
  const { user } = useAuth();
  // Cached + persisted: shows the last known balance instantly, refreshes on focus.
  const { data: balance, isPending } = useMyBalance<CrossGroupBalance>();
  const { data: groups } = useGroups();
  const [welcomeDone, setWelcomeDone] = useState(false);
  if (!authed) return null;
  // First run: people with no group yet see the welcome once (joining by invite skips it).
  const showWelcome = !welcomeDone && groups !== undefined && groups.length === 0 && !welcomeSeen();
  return (
    <>
      <DashboardView user={user} balance={balance} groups={groups} loading={isPending && !balance} />
      {showWelcome && <Welcome onDone={() => setWelcomeDone(true)} />}
    </>
  );
}
