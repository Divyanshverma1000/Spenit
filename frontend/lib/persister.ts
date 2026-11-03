import { get, set, del } from "idb-keyval";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";

const KEY = "spenit-query-cache";

/** Persists the React Query cache to IndexedDB so screens paint instantly on the next open. */
export const idbPersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    try { await set(KEY, client); } catch {}
  },
  restoreClient: async () => {
    try { return await get<PersistedClient>(KEY); } catch { return undefined; }
  },
  removeClient: async () => {
    try { await del(KEY); } catch {}
  },
};

export function clearPersistedCache() {
  idbPersister.removeClient();
}
