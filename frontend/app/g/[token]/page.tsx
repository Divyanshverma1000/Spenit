"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/Card";
import { Users, Link2Off, Clock, PartyPopper } from "lucide-react";

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

  useEffect(() => {
    if (isAuthenticated && state.stage === "preview") {
      joinGroup();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, state.stage]);

  async function joinGroup() {
    setState((s) => s.stage === "preview" ? { stage: "joining" } : s);
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
    login(authData.accessToken, authData.user, authData.refreshToken);

    const joinRes = await fetch(`${API_URL}/groups/join/${token}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authData.accessToken}` },
    });
    if (!joinRes.ok) return;
    const joinData = await joinRes.json();
    setState({ stage: "joined", groupId: joinData.groupId, groupName: joinData.groupName });
  }

  return (
    <main className="min-h-screen bg-[var(--ink)] flex flex-col items-center justify-center p-6 page-content">
      <div className="mb-10 text-center">
        <h1 
          className="text-3xl font-bold tracking-tight text-white"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Spenit
        </h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">Split expenses effortlessly</p>
      </div>

      <div className="w-full max-w-sm">
        {state.stage === "loading" && (
          <div className="flex justify-center py-12">
            <div className="spinner" />
          </div>
        )}

        {state.stage === "not_found" && (
          <Card padding="lg" className="text-center">
            <div className="flex justify-center mb-3 text-[var(--text-muted)]"><Link2Off size={40} strokeWidth={1.5} /></div>
            <p className="text-[var(--text-primary)] font-semibold">Link not found</p>
            <p className="text-[var(--text-secondary)] text-sm mt-1">This invite link may be invalid or the group was deleted.</p>
          </Card>
        )}

        {state.stage === "expired" && (
          <Card padding="lg" className="text-center">
            <div className="flex justify-center mb-3 text-[var(--text-muted)]"><Clock size={40} strokeWidth={1.5} /></div>
            <p className="text-[var(--text-primary)] font-semibold">Invite link expired</p>
            <p className="text-[var(--text-secondary)] text-sm mt-1">Ask a group member to share a new link.</p>
          </Card>
        )}

        {state.stage === "preview" && !isAuthenticated && (
          <Card padding="lg" className="space-y-6">
            <div className="text-center">
              <div className="mx-auto h-16 w-16 bg-[var(--paper-dim)] text-[var(--accent)] rounded-[var(--radius-sm)] flex items-center justify-center mb-3">
                <span className="text-2xl font-bold">{state.group.name.charAt(0).toUpperCase()}</span>
              </div>
              <p className="text-[var(--text-secondary)] text-sm">You've been invited to</p>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mt-1" style={{ fontFamily: 'var(--font-display)' }}>
                {state.group.name}
              </h2>
              <p className="text-[var(--text-secondary)] text-sm mt-1 flex items-center justify-center gap-1.5">
                <Users size={16} strokeWidth={1.5} />
                {state.group.memberCount} member{state.group.memberCount !== 1 ? "s" : ""} so far
              </p>
            </div>

            <div className="border-t border-[var(--border)] pt-5">
              <p className="text-sm text-[var(--text-secondary)] text-center mb-4">
                Sign in with Google to join
              </p>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => console.error("Google sign-in failed")}
                  theme="outline"
                  shape="rectangular"
                  size="large"
                  text="continue_with"
                />
              </div>
            </div>
          </Card>
        )}

        {(state.stage === "signing_in" || state.stage === "joining") && (
          <Card padding="lg" className="text-center">
            <div className="spinner mx-auto mb-4" />
            <p className="text-[var(--text-primary)] font-medium">
              {state.stage === "signing_in" ? "Signing you in…" : "Joining group…"}
            </p>
          </Card>
        )}

        {state.stage === "joined" && (
          <Card padding="lg" accentEdge="positive" className="text-center space-y-4">
            <div className="flex justify-center text-[var(--positive)]"><PartyPopper size={40} strokeWidth={1.5} /></div>
            <div>
              <p className="text-[var(--positive)] font-semibold text-lg">You're in!</p>
              <p className="text-[var(--text-secondary)] text-sm mt-1">
                You've joined <span className="font-semibold text-[var(--text-primary)]">{state.groupName}</span>
              </p>
            </div>
            <button
              id="go-to-group-btn"
              onClick={() => router.push(`/groups/${(state as { groupId: string }).groupId}`)}
              className="btn-primary w-full py-3"
            >
              Open Group →
            </button>
          </Card>
        )}
      </div>
    </main>
  );
}
