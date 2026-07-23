"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";

interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

interface AuthState {
  accessToken: string | null;
  user: User | null;
  /** true while the initial auto-refresh is in flight — prevents flash-to-/auth */
  initializing: boolean;
}

interface AuthContextValue {
  accessToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  initializing: boolean;
  login: (accessToken: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_URL =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"
    : "http://localhost:4000";

/**
 * AuthProvider — holds access token in React state (never localStorage/XSS-safe).
 * Architecture.md §10: JWT access token is short-lived; refresh token is httpOnly cookie.
 *
 * On mount: automatically calls POST /auth/refresh with the httpOnly cookie.
 * If the cookie is valid, the user is silently re-authenticated — no redirect to /auth.
 * This is what makes hard-refresh work without losing the session.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({
    accessToken: null,
    user: null,
    initializing: true, // Start true — we're checking the cookie
  });

  // ── Auto-refresh on mount (fixes hard-refresh → /auth redirect) ─────────────
  useEffect(() => {
    async function tryRefresh() {
      try {
        // Hit the refresh endpoint — uses the httpOnly cookie automatically
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });

        if (!res.ok) {
          // No valid cookie — user is logged out; redirect to /auth handled by pages
          setAuth({ accessToken: null, user: null, initializing: false });
          return;
        }

        const { accessToken } = await res.json();

        // Fetch the user profile with the new access token
        const userRes = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: "include",
        });

        if (!userRes.ok) {
          setAuth({ accessToken: null, user: null, initializing: false });
          return;
        }

        const userData = await userRes.json();
        setAuth({
          accessToken,
          user: {
            id: userData.id,
            username: userData.username,
            name: userData.name,
            email: userData.email,
            avatarUrl: userData.avatarUrl,
          },
          initializing: false,
        });
      } catch {
        // Network error (backend not running etc.) — don't crash, just not authed
        setAuth({ accessToken: null, user: null, initializing: false });
      }
    }

    tryRefresh();
  }, []); // Only on mount

  const login = useCallback((accessToken: string, user: User) => {
    setAuth({ accessToken, user, initializing: false });
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Best-effort
    }
    setAuth({ accessToken: null, user: null, initializing: false });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        accessToken: auth.accessToken,
        user: auth.user,
        isAuthenticated: !!auth.accessToken,
        initializing: auth.initializing,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
