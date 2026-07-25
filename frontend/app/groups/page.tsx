"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { EmptyState } from "@/components/ui/EmptyState";
import { GroupCard } from "@/components/ui/GroupCard";
import { Plus, Search } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface Group {
  id: string;
  name: string;
  icon: string | null;
  memberCount: number;
  myRole: string;
  createdAt: string;
}

export default function GroupsPage() {
  const authed = useRequireAuth();
  const { accessToken } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  function loadGroups() {
    if (!accessToken) return;
    fetch(`${API_URL}/groups`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : (data?.groups ?? []);
        setGroups(arr);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadGroups(); }, [accessToken]); // eslint-disable-line

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadGroups(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [accessToken]); // eslint-disable-line

  const filteredGroups = useMemo(() => {
    return groups.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [groups, searchQuery]);

  if (!authed) return null;

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb">
        {/* ── Sticky Premium Header ────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 bg-[var(--ink)]/80 backdrop-blur-xl px-6 pt-14 pb-4 border-b border-[rgba(0,0,0,0.03)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-[28px] font-bold text-[var(--text-primary)] tracking-tight">
                Groups
              </h1>
              <p className="text-[13px] font-medium text-[var(--text-secondary)] mt-0.5">
                {groups.length} active group{groups.length !== 1 ? 's' : ''}
              </p>
            </div>
            <Link href="/groups/new" className="h-10 w-10 bg-[var(--accent)] text-white rounded-[16px] flex items-center justify-center shadow-[0_4px_14px_rgba(245,158,11,0.3)] hover:scale-105 transition-transform">
              <Plus size={20} strokeWidth={2.5} />
            </Link>
          </div>
          
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={18} />
            <input 
              type="text"
              placeholder="Search groups..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white rounded-xl pl-10 pr-4 py-3 text-[15px] font-medium text-[var(--text-primary)] shadow-[0_2px_8px_rgba(0,0,0,0.02)] border border-[rgba(0,0,0,0.02)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)] transition-shadow placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>

        <div className="px-5 mt-6">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="spinner" />
            </div>
          ) : groups.length === 0 ? (
            <EmptyState
              type="no-groups"
              title="No groups yet"
              description="Create one and share the invite link with your friends"
              action={{
                label: "Create a Group",
                href: "/groups/new"
              }}
            />
          ) : (
            <motion.div 
              className="flex flex-col gap-4"
              initial="hidden"
              animate="show"
              variants={{
                hidden: { opacity: 0 },
                show: { opacity: 1, transition: { staggerChildren: 0.05 } }
              }}
            >
              {filteredGroups.length === 0 ? (
                <div className="py-12 text-center text-[var(--text-secondary)] font-medium">No groups match your search.</div>
              ) : (
                filteredGroups.map((group) => (
                  <motion.div
                    key={group.id}
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
                    }}
                  >
                    <GroupCard
                      id={group.id}
                      name={group.name}
                      memberCount={group.memberCount}
                      members={[]} // Handled by fallback inside GroupCard
                      lastActivity={new Date(group.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    />
                  </motion.div>
                ))
              )}
            </motion.div>
          )}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
