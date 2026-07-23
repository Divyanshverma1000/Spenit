"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";

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
        // Backend may return bare array or { groups: [...] }
        const arr = Array.isArray(data) ? data : (data?.groups ?? []);
        setGroups(arr);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadGroups(); }, [accessToken]); // eslint-disable-line

  // Refresh when tab becomes visible (user just added expense in another tab)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadGroups(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [accessToken]); // eslint-disable-line

  if (!authed) return null;

  return (
    <>
      <main className="min-h-screen bg-[#0a0a12] page-content">
        {/* Header */}
        <div className="px-5 pt-14 pb-4 flex items-end justify-between">
          <div>
            <p className="text-slate-500 text-xs font-medium uppercase tracking-widest">Your</p>
            <h1 className="text-2xl font-bold text-white">Groups</h1>
          </div>
          <Link href="/groups/new"
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 active:scale-95 transition-transform">
            <span className="text-base leading-none">+</span> New
          </Link>
        </div>

        <div className="px-5">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="h-8 w-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center mt-4">
              <p className="text-4xl mb-3">👥</p>
              <p className="text-white font-semibold mb-1">No groups yet</p>
              <p className="text-slate-500 text-sm mb-6">Create one and share the invite link with your friends</p>
              <Link href="/groups/new" className="btn-primary inline-flex px-6 py-3 text-sm">
                Create a Group
              </Link>
            </div>
          ) : (
            <div className="space-y-3 mt-2">
              {groups.map((group) => (
                <Link key={group.id} href={`/groups/${group.id}`}
                  className="flex items-center gap-4 rounded-2xl border border-white/8 bg-white/4 p-4 hover:bg-white/8 transition-colors active:scale-[0.98]">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/15 flex items-center justify-center text-2xl flex-shrink-0">
                    {group.icon || "👥"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{group.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
                      {" · "}
                      <span className={group.myRole === "admin" ? "text-violet-400" : "text-slate-500"}>
                        {group.myRole === "admin" ? "Admin" : "Member"}
                      </span>
                    </p>
                  </div>
                  <svg className="h-4 w-4 text-slate-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <BottomNav />
    </>
  );
}
