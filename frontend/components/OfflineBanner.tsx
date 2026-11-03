"use client";

import { useEffect, useState } from "react";
import { onlineManager } from "@tanstack/react-query";
import { CloudOff, RefreshCw } from "lucide-react";
import { useOutbox } from "@/context/OutboxContext";

/**
 * Slim status strip: shown only when offline or when expenses are waiting to sync,
 * so people always know their data is safe.
 */
export function OfflineBanner() {
  const { pendingCount, flush } = useOutbox();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // React Query assumes "online" until it sees an event, so a cold start with no signal
    // would never show the banner. Read the browser's real state first, then follow events.
    const sync = () => {
      const isOnline = navigator.onLine;
      onlineManager.setOnline(isOnline);
      setOnline(isOnline);
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (online && pendingCount === 0) return null;

  const plural = pendingCount > 1 ? "s" : "";

  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-2 px-4 py-1.5 text-[12px] font-semibold bg-[var(--accent)] text-white"
      style={{ paddingTop: "max(0.375rem, env(safe-area-inset-top))" }}
    >
      {online ? <RefreshCw size={13} className="animate-spin" /> : <CloudOff size={13} />}
      {!online
        ? pendingCount > 0
          ? `Offline: ${pendingCount} expense${plural} saved, will sync automatically`
          : "You're offline. Showing saved data"
        : `Syncing ${pendingCount} expense${plural}…`}
      {online && (
        <button onClick={() => flush()} className="underline ml-1">Retry now</button>
      )}
    </div>
  );
}
