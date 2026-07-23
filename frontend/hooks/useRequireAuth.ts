"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

/**
 * Guards a page — redirects to /auth ONLY after the initial session check completes.
 * While `initializing` is true (cookie refresh in flight), returns false and shows nothing
 * — prevents the flash-to-/auth on hard refresh before the httpOnly cookie is validated.
 */
export function useRequireAuth(): boolean {
  const { isAuthenticated, initializing } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Only redirect once we know for sure the user is not authenticated
    if (!initializing && !isAuthenticated) {
      router.replace("/auth");
    }
  }, [isAuthenticated, initializing, router]);

  return isAuthenticated;
}
