"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function NewGroupPage() {
  const authed = useRequireAuth();
  const { accessToken } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
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
        // Removed emoji icon field per design system rules
        body: JSON.stringify({ name: name.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || "Failed to create group");
        return;
      }

      const group = await res.json();
      router.push(`/groups/${group.id}`);
    } catch {
      setError("Network error — is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb">
        <PageHeader 
          title="New Group" 
          onBack={() => router.back()} 
        />

        <div className="px-5 mt-4">
          <Card padding="md">
            <form onSubmit={handleCreate} className="space-y-6">
              <div>
                <label htmlFor="group-name" className="block text-sm text-[var(--text-secondary)] mb-2">
                  Group name <span className="text-[var(--negative)]">*</span>
                </label>
                <input
                  id="group-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rajasthan Trip"
                  maxLength={80}
                  className="input-field w-full"
                  autoFocus
                />
              </div>

              {error && (
                <div className="text-sm text-[var(--negative)] bg-[var(--negative)]/10 border border-[var(--negative)]/20 rounded-[var(--radius-sm)] px-3 py-2">
                  {error}
                </div>
              )}

              <button 
                type="submit" 
                id="create-group-submit" 
                disabled={loading || !name.trim()}
                className="w-full btn-primary py-3.5 disabled:opacity-50"
              >
                {loading ? "Creating…" : `Create ${name.trim() || "Group"} →`}
              </button>
            </form>
          </Card>
        </div>
      </main>
      <BottomNav />
    </>
  );
}
