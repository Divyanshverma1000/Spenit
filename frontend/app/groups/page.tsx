"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Plus, Users, ChevronRight } from "lucide-react";

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

  if (!authed) return null;

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb">
        <PageHeader
          title="Groups"
          rightAction={
            <Link href="/groups/new" className="btn-primary flex items-center gap-1.5 px-4 py-2">
              <Plus size={16} strokeWidth={1.5} />
              <span>New</span>
            </Link>
          }
        />

        <div className="px-5 mt-4">
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
            <Card padding="none">
              <motion.div 
                className="divide-y divide-[var(--border)]"
                initial="hidden"
                animate="show"
                variants={{
                  hidden: { opacity: 0 },
                  show: {
                    opacity: 1,
                    transition: { staggerChildren: 0.05 }
                  }
                }}
              >
                {groups.map((group) => (
                  <motion.div
                    key={group.id}
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
                    }}
                  >
                    <Link
                      href={`/groups/${group.id}`}
                      className="flex items-center gap-4 p-4 hover:bg-[var(--paper-dim)] transition-colors active:scale-[0.98]"
                    >
                      <div className="h-10 w-10 rounded-[var(--radius-sm)] bg-[var(--paper-dim)] flex items-center justify-center flex-shrink-0 text-[var(--accent)] font-medium">
                        {group.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[var(--text-primary)] truncate">{group.name}</p>
                        <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                          {group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
                          {" · "}
                          <span className={group.myRole === "admin" ? "text-[var(--accent)] font-medium" : "text-[var(--text-muted)]"}>
                            {group.myRole === "admin" ? "Admin" : "Member"}
                          </span>
                        </p>
                      </div>
                      <ChevronRight size={20} strokeWidth={1.5} className="text-[var(--text-muted)] flex-shrink-0" />
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            </Card>
          )}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
