"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clearPersistedCache } from "@/lib/persister";
import { API_URL, ApiError } from "@/lib/api";

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
  /** true only until we know whether there is a (cached or fresh) session */
  initializing: boolean;
}

interface AuthContextValue {
  accessToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  initializing: boolean;
  login: (accessToken: string, user: User, refreshToken?: string) => void;
  logout: () => void;
  /**
   * fetch() against the API with the bearer token attached. Waits for the
   * background token refresh if it hasn't finished, and retries once with a
   * fresh token after a 401. Throws ApiError(401) if there is no session.
   */
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_KEY = "spenit_user";
const REFRESH_KEY = "refresh_token";

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function cacheUser(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {}
}

/**
 * AuthProvider — session handling built for slow / flaky networks.
 *
 * - The signed-in user is cached in localStorage, so the app renders the
 *   signed-in UI (and cached data) instantly instead of waiting for two
 *   sequential network calls (/auth/refresh then /users/me).
 * - The access token lives in memory only (XSS-safe); it is refreshed in the
 *   background from the httpOnly cookie / stored refresh token.
 * - The session is only dropped when the server says the refresh token is
 *   invalid (401). A network failure keeps the cached session, so the
 *   installed PWA still opens and works offline.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [auth, setAuth] = useState<AuthState>({
    accessToken: null,
    user: null,
    initializing: true,
  });

  const tokenRef = useRef<string | null>(null);
  const refreshInFlight = useRef<Promise<string | null> | null>(null);

  const endSession = useCallback(() => {
    tokenRef.current = null;
    cacheUser(null);
    try { localStorage.removeItem(REFRESH_KEY); } catch {}
    queryClient.clear();
    clearPersistedCache();
    setAuth({ accessToken: null, user: null, initializing: false });
  }, [queryClient]);

  /** Get a fresh access token. Resolves null if there is no valid session. Deduplicated. */
  const refreshAccessToken = useCallback((): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current;

    const run = async (): Promise<string | null> => {
      try {
        const storedRefreshToken = localStorage.getItem(REFRESH_KEY);
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: storedRefreshToken ? JSON.stringify({ refreshToken: storedRefreshToken }) : undefined,
        });

        if (res.status === 401 || res.status === 403) {
          endSession(); // the server rejected our session
          return null;
        }
        if (!res.ok) return tokenRef.current; // server hiccup: keep what we have

        const { accessToken, refreshToken } = await res.json();
        if (refreshToken) {
          try { localStorage.setItem(REFRESH_KEY, refreshToken); } catch {}
        }
        tokenRef.current = accessToken;
        setAuth((a) => ({ ...a, accessToken }));
        return accessToken as string;
      } catch {
        return tokenRef.current; // offline: keep the cached session
      } finally {
        refreshInFlight.current = null;
      }
    };

    refreshInFlight.current = run();
    return refreshInFlight.current;
  }, [endSession]);

  // ── On mount: show the cached session immediately, verify in the background ─
  useEffect(() => {
    const cached = readCachedUser();
    if (cached) setAuth({ accessToken: null, user: cached, initializing: false });

    (async () => {
      const token = await refreshAccessToken();
      if (!token) {
        // No session (or offline with nothing cached).
        setAuth((a) => (a.user ? a : { accessToken: null, user: null, initializing: false }));
        return;
      }
      try {
        const userRes = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
        });
        if (userRes.status === 401) { endSession(); return; }
        if (!userRes.ok) {
          setAuth((a) => ({ ...a, initializing: false }));
          return;
        }
        const u = await userRes.json();
        const user: User = {
          id: u.id, username: u.username, name: u.name, email: u.email, avatarUrl: u.avatarUrl,
        };
        cacheUser(user);
        setAuth({ accessToken: token, user, initializing: false });
      } catch {
        setAuth((a) => ({ ...a, initializing: false }));
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    (accessToken: string, user: User, refreshToken?: string) => {
      // A different person signing in on this device must never see the previous user's cached data.
      const previous = readCachedUser();
      if (previous && previous.id !== user.id) {
        queryClient.clear();
        clearPersistedCache();
      }
      if (refreshToken) {
        try { localStorage.setItem(REFRESH_KEY, refreshToken); } catch {}
      }
      cacheUser(user);
      tokenRef.current = accessToken;
      setAuth({ accessToken, user, initializing: false });
    },
    [queryClient]
  );

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
    } catch {
      // Best-effort
    }
    endSession();
  }, [endSession]);

  const authFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const send = (token: string) =>
        fetch(`${API_URL}${path}`, {
          ...init,
          headers: {
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...(init.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${token}`,
          },
        });

      let token = tokenRef.current ?? (await refreshAccessToken());
      if (!token) throw new ApiError(401, "Not signed in");

      let res = await send(token);
      if (res.status === 401) {
        token = await refreshAccessToken();
        if (!token) throw new ApiError(401, "Session expired");
        res = await send(token);
      }
      return res;
    },
    [refreshAccessToken]
  );

  return (
    <AuthContext.Provider
      value={{
        accessToken: auth.accessToken,
        user: auth.user,
        // Signed in = we know who the user is (cached or fresh); the token may still be on its way.
        isAuthenticated: !!auth.user,
        initializing: auth.initializing,
        login,
        logout,
        authFetch,
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
