"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { useAuth } from "@/context/AuthContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface GroupPreview {
  name: string;
  icon: string | null;
  memberCount: number;
}

type PageState =
  | { stage: "loading" }
  | { stage: "not_found" }
  | { stage: "expired" }
  | { stage: "preview"; group: GroupPreview }
  | { stage: "signing_in" }
  | { stage: "joining" }
  | { stage: "joined"; groupId: string; groupName: string };

export default function GroupInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { accessToken, isAuthenticated, login } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<PageState>({ stage: "loading" });

  // 1. Fetch public group preview (no auth required)
  useEffect(() => {
    fetch(`${API_URL}/groups/preview/${token}`)
      .then(async (res) => {
        if (res.status === 404) { setState({ stage: "not_found" }); return; }
        if (res.status === 410) { setState({ stage: "expired" }); return; }
        if (!res.ok) { setState({ stage: "not_found" }); return; }
        const data: GroupPreview = await res.json();
        setState({ stage: "preview", group: data });
      })
      .catch(() => setState({ stage: "not_found" }));
  }, [token]);

  // 2. If user is already signed in when they land on this page, join immediately
  useEffect(() => {
    if (isAuthenticated && state.stage === "preview") {
      joinGroup();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, state.stage]);

  async function joinGroup() {
    setState((s) =>
      s.stage === "preview" ? { stage: "joining" } : s
    );
    try {
      const res = await fetch(`${API_URL}/groups/join/${token}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        setState({ stage: "not_found" });
        return;
      }
      const data = await res.json();
      setState({ stage: "joined", groupId: data.groupId, groupName: data.groupName });
    } catch {
      setState({ stage: "not_found" });
    }
  }

  // 3. Google sign-in handler — sign in first, THEN join
  async function handleGoogleSuccess(credentialResponse: CredentialResponse) {
    if (!credentialResponse.credential) return;
    setState({ stage: "signing_in" });

    const authRes = await fetch(`${API_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ idToken: credentialResponse.credential }),
    });

    if (!authRes.ok) return;
    const authData = await authRes.json();
    // Update auth context so accessToken is available for the join call
    login(authData.accessToken, authData.user);

    // Join immediately using the freshly-issued token
    const joinRes = await fetch(`${API_URL}/groups/join/${token}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authData.accessToken}` },
    });
    if (!joinRes.ok) return;
    const joinData = await joinRes.json();
    setState({ stage: "joined", groupId: joinData.groupId, groupName: joinData.groupName });
  }

  const currentPreview =
    state.stage === "preview"
      ? state.group
      : state.stage === "joining" || state.stage === "signing_in"
        ? (state as unknown as { group?: GroupPreview }).group
        : null;

  return (
    <main className="min-h-screen bg-[#0a0a12] flex flex-col items-center justify-center p-6">
      {/* Branding */}
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-violet-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent">
          Spenit
        </h1>
        <p className="text-xs text-slate-500 mt-1">Split expenses effortlessly</p>
      </div>

      <div className="w-full max-w-sm">
        {/* Loading */}
        {state.stage === "loading" && (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          </div>
        )}

        {/* Not found */}
        {(state.stage === "not_found") && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <div className="text-4xl mb-3">🔗</div>
            <p className="text-white font-semibold">Link not found</p>
            <p className="text-slate-500 text-sm mt-1">This invite link may be invalid or the group was deleted.</p>
          </div>
        )}

        {/* Expired */}
        {state.stage === "expired" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <div className="text-4xl mb-3">⏰</div>
            <p className="text-white font-semibold">Invite link expired</p>
            <p className="text-slate-500 text-sm mt-1">Ask a group member to share a new link.</p>
          </div>
        )}

        {/* Preview — user NOT signed in */}
        {state.stage === "preview" && !isAuthenticated && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 space-y-6">
            {/* Group info */}
            <div className="text-center">
              <div className="text-5xl mb-3">{state.group.icon || "👥"}</div>
              <p className="text-slate-400 text-sm">You've been invited to</p>
              <h2 className="text-xl font-bold text-white mt-1">{state.group.name}</h2>
              <p className="text-slate-500 text-sm mt-1">
                {state.group.memberCount} member{state.group.memberCount !== 1 ? "s" : ""} so far
              </p>
            </div>

            <div className="border-t border-white/5 pt-5">
              <p className="text-sm text-slate-400 text-center mb-4">
                Sign in with Google to join — no search, no request needed
              </p>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => console.error("Google sign-in failed")}
                  theme="filled_black"
                  shape="pill"
                  size="large"
                  text="continue_with"
                />
              </div>
            </div>
          </div>
        )}

        {/* Signing in / joining state */}
        {(state.stage === "signing_in" || state.stage === "joining") && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <div className="h-10 w-10 rounded-full border-2 border-violet-500 border-t-transparent animate-spin mx-auto mb-4" />
            <p className="text-white font-medium">
              {state.stage === "signing_in" ? "Signing you in…" : "Joining group…"}
            </p>
          </div>
        )}

        {/* Joined successfully */}
        {state.stage === "joined" && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center space-y-4">
            <div className="text-5xl">🎉</div>
            <div>
              <p className="text-emerald-400 font-semibold text-lg">You're in!</p>
              <p className="text-slate-300 text-sm mt-1">
                You've joined <span className="font-semibold text-white">{state.groupName}</span>
              </p>
            </div>
            <button
              id="go-to-group-btn"
              onClick={() => router.push(`/groups/${state.stage === "joined" ? (state as { groupId: string }).groupId : ""}`)}
              className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 text-sm font-semibold text-white hover:from-violet-500 hover:to-fuchsia-500 transition-all"
            >
              Open Group →
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
