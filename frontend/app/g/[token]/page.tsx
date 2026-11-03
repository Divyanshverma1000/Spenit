"use client";

import { API_URL } from "@/lib/api";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/Card";
import { Users, Link2Off, Clock, PartyPopper, UserCheck, UserPlus } from "lucide-react";


interface UnclaimedMember {
  id: string;
  nickname: string;
}

interface GroupPreview {
  name: string;
  icon: string | null;
  memberCount: number;
  unclaimedMembers: UnclaimedMember[];
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
  const { accessToken, user, isAuthenticated, initializing, login } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<PageState>({ stage: "loading" });

  // "Who are you in this group?": either claim a name the admin already added,
  // or join as new with an optional nickname.
  const [claimId, setClaimId] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  // Prefill the nickname field with the user's first name once we know who they are.
  useEffect(() => {
    if (user?.name && nickname === "") setNickname(user.name.split(" ")[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name]);

  // Someone who is already in the group shouldn't be asked again, send them straight in.
  useEffect(() => {
    if (!isAuthenticated || !accessToken || state.stage !== "preview") return;
    fetch(`${API_URL}/groups`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((groups: { id: string; name: string; inviteToken: string }[]) => {
        const mine = groups.find((g) => g.inviteToken === token);
        if (mine) router.replace(`/groups/${mine.id}`);
      })
      .catch(() => {});
  }, [isAuthenticated, accessToken, state.stage, token, router]);

  async function joinGroup(bearer: string | null = accessToken) {
    if (!bearer) return;
    setError(null);
    setState((s) => (s.stage === "preview" ? { stage: "joining" } : s));
    try {
      const body = claimId
        ? { claimMemberId: claimId, nickname: nickname.trim() || undefined }
        : { nickname: nickname.trim() || undefined };
      const res = await fetch(`${API_URL}/groups/join/${token}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Name problems are recoverable: go back to the form with a hint.
        if (res.status === 409 || res.status === 404) {
          if (data.suggestion) setNickname(data.suggestion);
          if (data.code === "PLACEHOLDER_GONE") setClaimId(null);
          setError(data.error || "Couldn't join. Please try again.");
          // Refresh the preview so the claim list is current.
          const pv = await fetch(`${API_URL}/groups/preview/${token}`);
          if (pv.ok) { setState({ stage: "preview", group: await pv.json() }); return; }
        }
        setState({ stage: "not_found" });
        return;
      }
      setState({ stage: "joined", groupId: data.groupId, groupName: data.groupName });
    } catch {
      setState({ stage: "not_found" });
    }
  }

  async function handleGoogleSuccess(credentialResponse: CredentialResponse) {
    if (!credentialResponse.credential) return;
    const previous = state;
    setState({ stage: "signing_in" });

    const authRes = await fetch(`${API_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ idToken: credentialResponse.credential }),
    });

    if (!authRes.ok) { setState(previous); return; }
    const authData = await authRes.json();
    login(authData.accessToken, authData.user, authData.refreshToken);
    // Back to the preview; now that they're signed in it shows the name step.
    setState(previous);
  }

  const preview = state.stage === "preview" ? state.group : null;
  const showNicknameField = !claimId;

  return (
    <main className="min-h-screen bg-[var(--ink)] flex flex-col items-center justify-center p-6 page-content">
      <div className="mb-10 text-center">
        <h1
          className="text-3xl font-bold tracking-tight text-white"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Spenit
        </h1>
        <p className="text-xs text-[var(--text-muted)] mt-1">Split expenses effortlessly</p>
      </div>

      <div className="w-full max-w-sm">
        {(state.stage === "loading" || (state.stage === "preview" && initializing)) && (
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

        {preview && !initializing && (
          <Card padding="lg" className="space-y-6">
            <div className="text-center">
              <div className="mx-auto h-16 w-16 bg-[var(--paper-dim)] text-[var(--accent)] rounded-[var(--radius-sm)] flex items-center justify-center mb-3">
                <span className="text-2xl font-bold">{preview.name.charAt(0).toUpperCase()}</span>
              </div>
              <p className="text-[var(--text-secondary)] text-sm">You&apos;ve been invited to</p>
              <h2 className="text-xl font-bold text-[var(--text-primary)] mt-1" style={{ fontFamily: "var(--font-display)" }}>
                {preview.name}
              </h2>
              <p className="text-[var(--text-secondary)] text-sm mt-1 flex items-center justify-center gap-1.5">
                <Users size={16} strokeWidth={1.5} />
                {preview.memberCount} member{preview.memberCount !== 1 ? "s" : ""} so far
              </p>
            </div>

            {!isAuthenticated ? (
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
            ) : (
              <div className="border-t border-[var(--border)] pt-5 space-y-4">
                {preview.unclaimedMembers.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                      Are you already on the list?
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mb-3">
                      The group admin may have added you already. Pick your name to see what you owe.
                    </p>
                    <div className="space-y-2">
                      {preview.unclaimedMembers.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => { setClaimId(claimId === m.id ? null : m.id); setError(null); }}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-[12px] border text-left transition-colors ${
                            claimId === m.id
                              ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                              : "border-[var(--border)] bg-white"
                          }`}
                        >
                          <UserCheck size={18} className={claimId === m.id ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
                          <span className="font-semibold text-[var(--text-primary)]">I&apos;m {m.nickname}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {showNicknameField && (
                  <div>
                    <label htmlFor="nickname" className="block text-sm font-semibold text-[var(--text-primary)] mb-1.5">
                      {preview.unclaimedMembers.length > 0 ? "Or join as someone new" : "What should the group call you?"}
                    </label>
                    <div className="relative">
                      <UserPlus size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input
                        id="nickname"
                        value={nickname}
                        onChange={(e) => { setNickname(e.target.value); setError(null); }}
                        maxLength={30}
                        placeholder="Nickname"
                        className="w-full bg-white rounded-[12px] pl-10 pr-3 py-3 text-[15px] font-medium border border-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)]"
                      />
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-1.5">
                      Handy if there are two people with the same name. You can change it later.
                    </p>
                  </div>
                )}

                {error && (
                  <p role="alert" className="text-sm font-medium text-[var(--negative)]">{error}</p>
                )}

                <button
                  id="join-group-btn"
                  onClick={() => joinGroup()}
                  disabled={!claimId && nickname.trim().length === 0}
                  className="btn-primary w-full py-3 disabled:opacity-50"
                >
                  {claimId ? "Join as this person" : "Join group"}
                </button>
              </div>
            )}
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
              <p className="text-[var(--positive)] font-semibold text-lg">You&apos;re in!</p>
              <p className="text-[var(--text-secondary)] text-sm mt-1">
                You&apos;ve joined <span className="font-semibold text-[var(--text-primary)]">{state.groupName}</span>
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
