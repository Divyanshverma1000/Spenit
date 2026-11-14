"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff, CheckCircle2, Loader2, Send, Smartphone, XCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { readJson } from "@/lib/api";
import { ago } from "./AdminDashboard";

interface Data {
  myDevices: { id: string; service: string; device: string | null; added: string; seen: string | null }[];
  everyone: { devices: number; people: number };
  log: { id: number; created_at: string; title: string; tag: string | null; devices: number; delivered: number; failed: number; removed: number; error: string | null; name: string }[];
}
interface TestResult { devices: number; delivered: number; failed: number; removed: number; errors: string[] }

/**
 * Admin → Notifications: did that notification go out? Which of your devices can get them,
 * a test button that says exactly what happened, and the last 40 sends with their result.
 */
export function AdminNotifications() {
  const { authFetch } = useAuth();
  const q = useQuery({
    queryKey: ["admin-notifications"],
    queryFn: async () => readJson<Data>(await authFetch("/admin/notifications")),
    refetchInterval: 60_000,
    retry: false,
  });
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  async function sendTest() {
    setTesting(true);
    try {
      setTest(await readJson<TestResult>(await authFetch("/admin/notifications/test", { method: "POST" })));
      void q.refetch();
    } catch {
      setTest({ devices: 0, delivered: 0, failed: 1, removed: 0, errors: ["Couldn't reach the server"] });
    } finally {
      setTesting(false);
    }
  }

  const d = q.data;
  return (
    <section>
      <h2 className="text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">Notifications</h2>
      <div className="rounded-[18px] bg-[var(--paper)] border border-[var(--hairline)] overflow-hidden">
        <div className="p-4">
          <p className="text-[14px] font-bold">Your devices</p>
          {!d ? (
            <Loader2 size={16} className="mt-2 animate-spin text-[var(--text-muted)]" />
          ) : d.myDevices.length === 0 ? (
            <p className="mt-1 text-[13px] text-[var(--text-secondary)] flex gap-2">
              <BellOff size={15} className="flex-shrink-0 mt-0.5 text-[var(--warn)]" />
              None. Notifications reach a device only after you turn them on in Spenit there: Profile → Notifications, on each phone or laptop you use.
              The browser&apos;s own permission alone isn&apos;t enough.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {d.myDevices.map((x) => (
                <li key={x.id} className="flex items-center gap-2.5 text-[13px]">
                  <Smartphone size={15} className="text-[var(--positive)] flex-shrink-0" />
                  <span className="flex-1 min-w-0 truncate font-semibold">{x.device ?? x.service}</span>
                  <span className="text-[11.5px] text-[var(--text-muted)]">on since {ago(x.added)}</span>
                </li>
              ))}
            </ul>
          )}
          {d && <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">Across Spenit: {d.everyone.people} people have notifications on, on {d.everyone.devices} devices.</p>}

          <button
            onClick={() => void sendTest()}
            disabled={testing}
            className="mt-3 h-10 px-4 rounded-full bg-[var(--accent)] text-white text-[13px] font-bold flex items-center gap-2 disabled:opacity-60"
          >
            {testing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send me a test
          </button>
          {test && (
            <p className={`mt-2 text-[12.5px] font-semibold flex gap-1.5 ${test.delivered > 0 ? "text-[var(--positive)]" : "text-[var(--negative)]"}`}>
              {test.delivered > 0 ? <CheckCircle2 size={15} className="flex-shrink-0 mt-px" /> : <XCircle size={15} className="flex-shrink-0 mt-px" />}
              {test.delivered > 0
                ? `Sent to ${test.delivered} of ${test.devices} ${test.devices === 1 ? "device" : "devices"}. It should appear within a few seconds.`
                : test.errors[0] ?? "Nothing was sent."}
            </p>
          )}
        </div>

        <div className="border-t border-[var(--hairline)]">
          <p className="px-4 pt-3 text-[12px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Last sent</p>
          {d && d.log.length === 0 && <p className="px-4 py-3 text-[13px] text-[var(--text-secondary)]">Nothing sent yet. Every notification will be listed here with what happened to it.</p>}
          <ul className="divide-y divide-[var(--hairline)]">
            {d?.log.map((l) => {
              const ok = l.delivered > 0;
              const none = l.devices === 0;
              return (
                <li key={l.id} className="px-4 py-2.5 flex items-start gap-2.5">
                  <span className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${ok ? "bg-[var(--positive)]/15 text-[var(--positive)]" : none ? "bg-[var(--paper-dim)] text-[var(--text-muted)]" : "bg-[var(--negative)]/15 text-[var(--negative)]"}`}>
                    {ok ? <Bell size={12} /> : none ? <BellOff size={12} /> : <XCircle size={12} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold truncate">{l.title} <span className="font-normal text-[var(--text-secondary)]">→ {l.name}</span></span>
                    <span className="block text-[11.5px] text-[var(--text-muted)]">
                      {ok ? `Delivered to ${l.delivered} of ${l.devices} ${l.devices === 1 ? "device" : "devices"}` : none ? "Not sent: notifications aren't on for this person" : `Failed${l.error ? `: ${l.error}` : ""}`}
                      {l.removed > 0 ? ` · ${l.removed} old device removed` : ""} · {ago(l.created_at)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
