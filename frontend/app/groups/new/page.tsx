"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

// Common emoji icons for groups — quick picker
const ICONS = ["🏕️", "🏠", "✈️", "🍕", "🏖️", "🎉", "🎬", "🚗", "🏋️", "📚", "💼", "🎮"];

export default function NewGroupPage() {
  const authed = useRequireAuth();
  const { accessToken } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("👥");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!authed) return null;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/groups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: name.trim(), icon }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to create group");
        return;
      }

      const group = await res.json();
      // Go straight to the group detail page which shows the invite link + QR
      router.push(`/groups/${group.id}`);
    } catch {
      setError("Network error — is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <main className="min-h-screen bg-[#0a0a12] page-content">
        <div className="px-5 pt-14 pb-4 flex items-center gap-3">
          <button onClick={() => router.back()} className="text-slate-500 hover:text-slate-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-white">Create a Group</h1>
        </div>

        <div className="px-5">
          <form onSubmit={handleCreate} className="glass-card p-6 space-y-6">
            {/* Icon picker */}
            <div>
              <label className="block text-sm text-slate-400 mb-3">Group icon</label>
              <div className="grid grid-cols-6 gap-2">
                {ICONS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setIcon(em)}
                    className={`h-10 w-10 rounded-lg text-xl flex items-center justify-center transition-all ${
                      icon === em ? "bg-violet-500/30 ring-2 ring-violet-500" : "bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="group-name" className="block text-sm text-slate-400 mb-2">
                Group name <span className="text-rose-400">*</span>
              </label>
              <input
                id="group-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rajasthan Trip"
                maxLength={80}
                className="w-full rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-600 px-4 py-3 text-sm focus:outline-none focus:border-violet-500/50 transition-all"
                autoFocus
              />
            </div>

            {error && <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>}

            <button type="submit" id="create-group-submit" disabled={loading || !name.trim()}
              className="w-full btn-primary py-3.5 text-sm disabled:opacity-50">
              {loading ? "Creating…" : `Create ${icon} ${name.trim() || "Group"} →`}
            </button>
          </form>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
