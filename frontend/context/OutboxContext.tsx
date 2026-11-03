"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  ExpenseDraft, OutboxItem, loadOutbox, saveOutbox, newOutboxItem,
} from "@/lib/outbox";

interface OutboxContextValue {
  items: OutboxItem[];
  pendingCount: number;
  /** Save an expense locally and send it in the background. Resolves as soon as it is stored. */
  enqueue: (draft: ExpenseDraft) => Promise<OutboxItem>;
  retry: (id: string) => void;
  discard: (id: string) => void;
  flush: () => Promise<void>;
}

const OutboxContext = createContext<OutboxContextValue | null>(null);

export function OutboxProvider({ children }: { children: ReactNode }) {
  const { authFetch, user } = useAuth();
  const queryClient = useQueryClient();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const itemsRef = useRef<OutboxItem[]>([]);
  const flushing = useRef(false);
  const loaded = useRef(false);

  const commit = useCallback((next: OutboxItem[]) => {
    itemsRef.current = next;
    setItems(next);
    saveOutbox(next);
  }, []);

  useEffect(() => {
    loadOutbox().then((stored) => {
      loaded.current = true;
      // Items enqueued before the load finished must not be lost.
      const merged = [...stored, ...itemsRef.current.filter((i) => !stored.some((s) => s.id === i.id))];
      itemsRef.current = merged;
      setItems(merged);
    });
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current || !user) return;
    flushing.current = true;
    try {
      // Oldest first, one at a time, so expenses keep their order.
      for (const item of [...itemsRef.current]) {
        if (item.status !== "pending") continue;
        let res: Response;
        try {
          res = await authFetch("/expenses", {
            method: "POST",
            headers: { "Idempotency-Key": item.id },
            body: JSON.stringify(item.draft),
          });
        } catch {
          return; // offline, network error or signed out: keep the items and try again later
        }

        if (res.ok) {
          // Refresh the group first so the real expense is on screen before the placeholder goes away.
          await queryClient.refetchQueries({ queryKey: ["group", item.draft.groupId] }).catch(() => {});
          queryClient.invalidateQueries({ queryKey: ["groups"] });
          queryClient.invalidateQueries({ queryKey: ["balance"] });
          commit(itemsRef.current.filter((i) => i.id !== item.id));
        } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          // The server rejected it for good (e.g. someone was removed from the group).
          // Keep it visible so it isn't silently lost.
          const data = await res.json().catch(() => ({}));
          commit(
            itemsRef.current.map((i) =>
              i.id === item.id ? { ...i, status: "failed", error: data.error || `Rejected (${res.status})` } : i
            )
          );
        } else {
          return; // 5xx / rate-limit: retry later
        }
      }
    } finally {
      flushing.current = false;
    }
  }, [authFetch, commit, queryClient, user]);

  // Flush on start-up, when the connection comes back, and when the app is reopened.
  useEffect(() => {
    if (!user) return;
    const run = () => { if (loaded.current) flush(); };
    const t = setTimeout(run, 1500); // after the stored items have loaded
    window.addEventListener("online", run);
    const onVisible = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(run, 30_000);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [flush, user]);

  const enqueue = useCallback(
    async (draft: ExpenseDraft) => {
      const item = newOutboxItem(draft);
      commit([...itemsRef.current, item]);
      queueMicrotask(() => { flush(); });
      return item;
    },
    [commit, flush]
  );

  const retry = useCallback(
    (id: string) => {
      commit(itemsRef.current.map((i) => (i.id === id ? { ...i, status: "pending", error: undefined } : i)));
      flush();
    },
    [commit, flush]
  );

  const discard = useCallback(
    (id: string) => commit(itemsRef.current.filter((i) => i.id !== id)),
    [commit]
  );

  const value = useMemo<OutboxContextValue>(
    () => ({
      items,
      pendingCount: items.filter((i) => i.status === "pending").length,
      enqueue, retry, discard, flush,
    }),
    [items, enqueue, retry, discard, flush]
  );

  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): OutboxContextValue {
  const ctx = useContext(OutboxContext);
  if (!ctx) throw new Error("useOutbox must be used inside <OutboxProvider>");
  return ctx;
}
