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
    <div className="min-h-screen bg-[var(--ink)] flex items-center justify-center">
      <div className="text-center flex flex-col items-center space-y-4">
        <div className="spinner w-[20px] h-[20px]" />
        <p className="text-[var(--text-muted)] text-[13px] font-[var(--font-body)]">
          Loading Spenit...
        </p>
      </div>
    </div>
  );
}
