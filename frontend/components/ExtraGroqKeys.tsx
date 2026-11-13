"use client";

import { useState } from "react";
import { Gauge, Key, Loader2, Plus, Trash2 } from "lucide-react";
import { ask, toast } from "@/lib/dialog";

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>;

/**
 * Profile → AI Assistant → "Read screenshots faster".
 * Extra Groq keys are lanes: each screenshot in a big import is read with one key, so
 * 3 keys read 3 screenshots side by side. Groq limits each Groq *account*, so keys
 * help only when they come from different accounts.
 */
export default function ExtraGroqKeys({
  initial, max, authFetch,
}: {
  initial: string[];
  max: number;
  authFetch: AuthFetch;
}) {
  const [keys, setKeys] = useState<string[]>(initial);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await authFetch("/users/me");
    if (res.ok) {
      const me = (await res.json()) as { groqExtraKeysMasked?: string[] };
      setKeys(me.groqExtraKeysMasked ?? []);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      const res = await authFetch("/users/me", { method: "PATCH", body: JSON.stringify({ addGroqKey: value.trim() }) });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast(err.error || "Couldn't add the key", "error");
        return;
      }
      setValue("");
      setAdding(false);
      await refresh();
      toast("Key added. Big imports will read faster.");
    } catch {
      toast("Couldn't add the key. Check your connection.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(i: number) {
    const ok = await ask({
      title: "Remove this key?",
      body: `${keys[i]} won't be used for reading screenshots any more.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    const res = await authFetch("/users/me", { method: "PATCH", body: JSON.stringify({ removeGroqKey: i }) }).catch(() => null);
    if (!res?.ok) { toast("Couldn't remove the key", "error"); return; }
    await refresh();
  }

  const lanes = 1 + keys.length;

  return (
    <div className="mt-5 pt-4 border-t border-[var(--hairline)]">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-[12px] bg-[var(--accent-subtle)] text-[var(--accent)]">
          <Gauge size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-[14px] font-bold text-[var(--text-primary)]">Read screenshots faster</h4>
          <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 leading-snug">
            Each extra key reads another screenshot at the same time.{" "}
            {lanes > 1 ? <b className="text-[var(--text-primary)]">Now reading {lanes} at once.</b> : null}
          </p>
          <p className="text-[11.5px] text-[var(--text-muted)] mt-1 leading-snug">
            Groq limits each Groq account, not each key. Extra keys only help if they come from a different Groq account.
          </p>
        </div>
      </div>

      {keys.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {keys.map((k, i) => (
            <li key={`${k}-${i}`} className="flex items-center justify-between bg-[var(--bg-main)] border border-[var(--hairline)] rounded-[12px] px-3 py-2">
              <code className="font-mono text-[13px] font-medium text-[var(--text-secondary)]">
                <span className="text-[var(--text-muted)] mr-2">{i + 2}</span>{k}
              </code>
              <button onClick={() => void remove(i)} className="p-1 text-[var(--text-muted)]" aria-label={`Remove key ${k}`}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form onSubmit={add} className="flex gap-2 mt-3">
          <div className="relative flex-1">
            <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="gsk_..."
              className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-main)] border border-[var(--hairline)] rounded-[12px] text-[13px] font-medium outline-none focus:border-[var(--accent)] transition-colors"
              autoFocus
            />
          </div>
          <button type="submit" disabled={busy || !value.trim()} className="bg-[var(--accent)] text-white px-4 rounded-[12px] font-bold text-[13px] shadow-sm disabled:opacity-50 flex items-center">
            {busy ? <Loader2 size={14} className="animate-spin" /> : "Add"}
          </button>
        </form>
      ) : keys.length < max ? (
        <button
          onClick={() => setAdding(true)}
          className="mt-3 w-full bg-[var(--ink)] text-[var(--text-primary)] font-bold text-[12px] py-2 rounded-[10px] active:scale-95 transition-transform flex items-center justify-center gap-1"
        >
          <Plus size={14} /> Add another key
        </button>
      ) : (
        <p className="mt-3 text-[12px] text-[var(--text-muted)]">That&rsquo;s the most keys you can add ({max}).</p>
      )}
    </div>
  );
}
