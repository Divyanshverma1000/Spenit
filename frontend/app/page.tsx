"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function RootPage() {
  const { isAuthenticated, initializing } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!initializing) {
      router.replace(isAuthenticated ? "/dashboard" : "/auth");
    }
  }, [isAuthenticated, initializing, router]);

  // Show spinner while session check is in flight
  return (
    <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-3xl shadow-2xl shadow-violet-500/30 animate-pulse">
          ₹
        </div>
        <p className="text-slate-500 text-sm">Loading Spenit…</p>
      </div>
    </div>
  );
}
