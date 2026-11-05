"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";
import { groupKey, useGroupOverview } from "@/lib/queries";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { PageHeader } from "@/components/ui/PageHeader";
import BottomNav from "@/components/BottomNav";
import { AvatarPeople } from "@/components/ui/MemberAvatar";
import ActivityFeed from "@/components/ActivityFeed";
import type { ActivityItem } from "@/lib/activity";

/**
 * Everything that changed money or membership in the group, for every member to see.
 * Filter by kind, read it day by day; each card says who did what (names in colour),
 * the amount, and for edits every change as old → new. Deleted bills can be restored.
 */
export default function GroupActivityPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const authed = useRequireAuth();
  const { authFetch, user } = useAuth();
  const queryClient = useQueryClient();
  const { data: overview } = useGroupOverview(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const feed = useInfiniteQuery({
    queryKey: ["activity", id],
    queryFn: async ({ pageParam }) =>
      readJson<{ items: ActivityItem[]; nextBefore: number | null }>(
        await authFetch(`/groups/${id}/activity${pageParam ? `?before=${pageParam}` : ""}`)
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: authed,
  });

  async function restore(expenseId: string) {
    setBusy(expenseId);
    setError(null);
    try {
      await readJson(await authFetch(`/expenses/${expenseId}/restore`, { method: "POST" }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["activity", id] }),
        queryClient.invalidateQueries({ queryKey: groupKey(id) }),
        queryClient.invalidateQueries({ queryKey: ["balance"] }),
      ]);
    } catch (err) {
      setError((err as Error).message || "Couldn't restore it");
    } finally {
      setBusy(null);
    }
  }

  if (!authed) return null;

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb max-w-md mx-auto">
        <PageHeader title="Activity" subtitle={overview?.group.name} onBack={() => router.back()} />
        <AvatarPeople people={overview?.group.members ?? []}>
          <div className="px-5 pb-8">
            <ActivityFeed
              items={feed.data?.pages.flatMap((p) => p.items) ?? []}
              me={user?.id}
              isAdmin={overview?.group.myRole === "admin"}
              loading={feed.isPending}
              failed={feed.isError}
              busy={busy}
              error={error}
              onRestore={restore}
            />
            {feed.hasNextPage && (
              <button
                onClick={() => feed.fetchNextPage()}
                disabled={feed.isFetchingNextPage}
                className="mt-2 w-full py-3 rounded-[14px] bg-[var(--paper)] border border-[var(--hairline)] text-[14px] font-semibold"
              >
                {feed.isFetchingNextPage ? "Loading…" : "Show older"}
              </button>
            )}
          </div>
        </AvatarPeople>
      </main>
      <BottomNav />
    </>
  );
}
