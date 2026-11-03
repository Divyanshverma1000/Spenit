"use client";

import { GoogleOAuthProvider } from "@react-oauth/google";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { AuthProvider } from "@/context/AuthContext";
import { OutboxProvider } from "@/context/OutboxContext";
import { OfflineBanner } from "@/components/OfflineBanner";
import { idbPersister } from "@/lib/persister";
import { ReactNode, useState } from "react";

const WEEK = 7 * 24 * 60 * 60 * 1000;
// Bump when the shape of cached API data changes, so old caches are discarded.
const CACHE_VERSION = "2";

/**
 * Client-side providers wrapper.
 * Kept in a separate file so layout.tsx can remain a Server Component
 * (required for Next.js metadata export to work correctly).
 */
export default function Providers({ children }: { children: ReactNode }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: WEEK, // must be >= persist maxAge or the cache is dropped early
            retry: 1,
            refetchOnWindowFocus: true, // replaces the old 30s polling
            refetchOnReconnect: true,
          },
        },
      })
  );

  return (
    <GoogleOAuthProvider clientId={clientId}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: idbPersister, maxAge: WEEK, buster: CACHE_VERSION }}
      >
        <AuthProvider>
          <OutboxProvider>
            <OfflineBanner />
            {children}
          </OutboxProvider>
        </AuthProvider>
      </PersistQueryClientProvider>
    </GoogleOAuthProvider>
  );
}
