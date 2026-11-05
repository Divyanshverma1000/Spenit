"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft, CheckCircle2, Loader2, LogOut, Pencil, PlusCircle, RotateCcw, Trash2, UserCheck, UserMinus, UserPlus, Undo2, XCircle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";
import { groupKey, useGroupOverview } from "@/lib/queries";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { PageHeader } from "@/components/ui/PageHeader";
import BottomNav from "@/components/BottomNav";
import { changes, sentence, type ActivityItem } from "@/lib/activity";

const ICON: Record<string, { icon: typeof Pencil; tone: string }> = {
  expense_added: { icon: PlusCircle, tone: "#14B8A6" },
  expense_edited: { icon: Pencil, tone: "#F59E0B" },
  expense_deleted: { icon: Trash2, tone: "#F43F5E" },
  expense_restored: { icon: RotateCcw, tone: "#14B8A6" },
  settlement_recorded: { icon: ArrowRightLeft, tone: "#8B5CF6" },
  settlement_confirmed: { icon: CheckCircle2, tone: "#22C55E" },
  settlement_rejected: { icon: XCircle, tone: "#F43F5E" },
  member_joined: { icon: UserPlus, tone: "#14B8A6" },
  member_added: { icon: UserPlus, tone: "#94A3B8" },
  member_claimed: { icon: UserCheck, tone: "#F59E0B" },
  claim_undone: { icon: Undo2, tone: "#F59E0B" },
  member_left: { icon: LogOut, tone: "#94A3B8" },
  member_removed: { icon: UserMinus, tone: "#F43F5E" },
};

function when(iso: string) {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/**
 * Everything that changed money or membership in the group, newest first, for every
 * member to see: who added, edited (with before → after), deleted or restored a bill,
 * payments, joins, name fixes and people leaving. Deleted bills can be restored here.
 */
export default function GroupActivityPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const authed = useRequireAuth();
  const { authFetch, user } = useAuth();
  const queryClient = useQueryClient();
  const { data: overview } = useGroupOverview(id);
  const isAdmin = overview?.group.myRole === "admin";
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
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb max-w-md mx-auto">
        <PageHeader title="Activity" subtitle={overview?.group.name} onBack={() => router.back()} />
        <div className="px-5 pb-8">
          <p className="text-[13px] text-[var(--text-secondary)] mb-4">
            Every change to bills, payments and members. Everyone in the group sees the same list.
          </p>
          {error && <p role="alert" className="mb-3 text-[13px] font-medium text-[var(--negative)]">{error}</p>}

          {feed.isPending ? (
            <div className="flex justify-center py-12"><div className="spinner" /></div>
          ) : feed.isError ? (
            <p className="text-[14px] text-[var(--text-secondary)]">Couldn&apos;t load the activity. Pull to refresh or try again.</p>
          ) : items.length === 0 ? (
            <div className="p-6 rounded-[20px] bg-[var(--paper)] border border-[var(--hairline)] text-center text-[14px] text-[var(--text-secondary)]">
              Nothing yet. Changes from now on show up here.
            </div>
          ) : (
            <ol className="relative">
              {items.map((a, i) => {
                const meta = ICON[a.kind] ?? { icon: Pencil, tone: "#94A3B8" };
                const Icon = meta.icon;
                const diff = a.kind === "expense_edited" ? changes(a.summary.before, a.summary.after) : [];
                const canRestore =
                  a.kind === "expense_deleted" && a.expenseDeleted && a.expenseId && (isAdmin || a.actor?.id === user?.id);
                return (
                  <li key={a.id} className="relative flex gap-3 pb-4">
                    {i < items.length - 1 && <span className="absolute left-[17px] top-9 bottom-0 w-px bg-[var(--hairline)]" aria-hidden />}
                    <span className="relative w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${meta.tone}1F`, color: meta.tone }}>
                      <Icon size={17} strokeWidth={2.3} />
                    </span>
                    <div className="flex-1 min-w-0 pt-1">
                      <p className="text-[14px] font-semibold text-[var(--text-primary)] leading-snug">{sentence(a, user?.id)}</p>
                      {diff.length > 0 && (
                        <ul className="mt-1.5 rounded-[12px] bg-[var(--paper)] border border-[var(--hairline)] px-3 py-2 space-y-0.5 text-[12.5px] text-[var(--text-secondary)]">
                          {diff.map((d) => <li key={d}>{d}</li>)}
                        </ul>
                      )}
                      <div className="mt-1 flex items-center gap-3">
                        <span className="text-[12px] text-[var(--text-muted)]">{when(a.createdAt)}</span>
                        {canRestore && (
                          <button
                            onClick={() => restore(a.expenseId!)}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1 text-[12px] font-bold text-[var(--accent)]"
                          >
                            {busy === a.expenseId ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Restore
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

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
      </main>
      <BottomNav />
    </>
  );
}
