"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { usePushNotifications, needsIOSInstall } from "@/hooks/usePushNotifications";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface UserProfile {
  id: string;
  username: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  upiId: string | null;
  createdAt: string;
  hasGroqKey?: boolean;
  groqKeyMasked?: string | null;
}

export default function ProfilePage() {
  const authed = useRequireAuth();
  const { accessToken, logout } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [upiId, setUpiId] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [savingUpi, setSavingUpi] = useState(false);
  const [savedUpi, setSavedUpi] = useState(false);
  const [savingGroq, setSavingGroq] = useState(false);
  const [savedGroq, setSavedGroq] = useState(false);
  const [loading, setLoading] = useState(true);
  const { state: pushState, loading: pushLoading, subscribe, unsubscribe } = usePushNotifications();

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${API_URL}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json())
      .then((data: UserProfile) => {
        setProfile(data);
        setUpiId(data.upiId || "");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  async function saveUpiId() {
    if (!accessToken) return;
    setSavingUpi(true);
    try {
      const res = await fetch(`${API_URL}/users/me`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ upiId }),
      });
      if (res.ok) {
        setProfile((p) => p ? { ...p, upiId } : p);
        setSavedUpi(true);
        setTimeout(() => setSavedUpi(false), 2500);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingUpi(false);
    }
  }

  async function saveGroqKey() {
    if (!accessToken) return;
    setSavingGroq(true);
    try {
      const res = await fetch(`${API_URL}/users/me`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ groqApiKey: groqKey }),
      });
      if (res.ok) {
        setProfile((p) => p ? { ...p, hasGroqKey: true, groqKeyMasked: `gsk_***${groqKey.slice(-4)}` } : p);
        setSavedGroq(true);
        setGroqKey(""); // clear the input after saving for security
        setTimeout(() => setSavedGroq(false), 2500);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingGroq(false);
    }
  }

  async function handleLogout() {
    await logout();
    router.replace("/auth");
  }

  if (!authed) return null;

  return (
    <>
      <main className="min-h-screen bg-[#0a0a12] page-content">
        {/* Header */}
        <div className="px-5 pt-14 pb-4">
          <p className="text-slate-500 text-xs font-medium uppercase tracking-widest">Account</p>
          <h1 className="text-2xl font-bold text-white">Profile</h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
          </div>
        ) : profile ? (
          <div className="px-5 space-y-4">
            {/* Avatar + name card */}
            <div className="glass-card p-6 flex items-center gap-4">
              <div className="relative flex-shrink-0">
                {profile.avatarUrl ? (
                  <Image src={profile.avatarUrl} alt={profile.name} width={64} height={64}
                    className="rounded-full ring-2 ring-violet-500/30" />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-2xl font-bold text-white">
                    {profile.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="absolute bottom-0 right-0 h-4 w-4 rounded-full bg-emerald-400 ring-2 ring-[#0a0a12]" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-white text-lg truncate">{profile.name}</p>
                <p className="text-violet-400 text-sm font-mono">@{profile.username}</p>
                <p className="text-slate-500 text-xs truncate">{profile.email}</p>
              </div>
            </div>

            {/* UPI ID — critical for settle-up flow */}
            <div className="glass-card p-5 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">💳</span>
                <h2 className="text-sm font-semibold text-white">UPI ID</h2>
                <span className="text-xs text-slate-500">(for receiving settlements)</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="yourname@upi or yourname@oksbi"
                  value={upiId}
                  onChange={(e) => { setUpiId(e.target.value); setSavedUpi(false); }}
                  className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 transition-colors"
                />
                <button
                  onClick={saveUpiId}
                  disabled={savingUpi}
                  className="flex-shrink-0 btn-primary px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  {savingUpi ? "…" : savedUpi ? "✓" : "Save"}
                </button>
              </div>
              {!profile.upiId && (
                <p className="text-xs text-amber-400/80">
                  ⚠ Set your UPI ID so group members can generate a pre-filled payment link when settling with you.
                </p>
              )}
              {savedUpi && (
                <p className="text-xs text-emerald-400">✓ UPI ID saved — others can now pay you via deep link</p>
              )}
            </div>

            {/* BYOK: Groq API Key */}
            <div className="glass-card p-5 space-y-3 border border-fuchsia-500/20">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🤖</span>
                <h2 className="text-sm font-semibold text-white">Bring Your Own AI</h2>
                <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-xs text-fuchsia-400 hover:underline ml-auto">
                  Get a free key ↗
                </a>
              </div>
              <p className="text-xs text-slate-400">
                Provide a <span className="font-semibold text-slate-300">Groq API Key</span> to enable voice entry and conversational ledger queries. Your key is stored securely.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder={profile.hasGroqKey && profile.groqKeyMasked ? profile.groqKeyMasked : "gsk_..."}
                  value={groqKey}
                  onChange={(e) => { setGroqKey(e.target.value); setSavedGroq(false); }}
                  className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-fuchsia-500/50 transition-colors"
                />
                <button
                  onClick={saveGroqKey}
                  disabled={savingGroq || !groqKey}
                  className="flex-shrink-0 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {savingGroq ? "…" : savedGroq ? "✓" : profile.hasGroqKey ? "Update" : "Save"}
                </button>
              </div>
              {!profile.hasGroqKey && (
                <p className="text-xs text-amber-400/80">
                  ⚠ AI features are disabled until you provide a key.
                </p>
              )}
              {savedGroq && (
                <p className="text-xs text-emerald-400">✓ API Key saved — AI features unlocked!</p>
              )}
            </div>

            {/* Account info */}
            <div className="glass-card p-5 space-y-1">
              <h2 className="text-sm font-semibold text-white mb-3">Account info</h2>
              {[
                { label: "Username", value: `@${profile.username}` },
                { label: "Member since", value: new Date(profile.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "long" }) },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
                  <span className="text-sm text-slate-400">{label}</span>
                  <span className="text-sm text-slate-200">{value}</span>
                </div>
              ))}
            </div>

            {/* Notifications */}
            <div className="glass-card p-5">
              <h2 className="text-sm font-semibold text-white mb-3">🔔 Notifications</h2>
              {needsIOSInstall() ? (
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3">
                  <p className="text-xs text-amber-300 font-medium mb-1">Install to home screen required</p>
                  <p className="text-xs text-amber-200/70 leading-relaxed">
                    iOS requires the app to be installed to your home screen before push notifications work (iOS 16.4+).
                    In Safari, tap <strong>Share → Add to Home Screen</strong>, then open from the home screen.
                  </p>
                </div>
              ) : pushState === "denied" ? (
                <p className="text-xs text-slate-500">
                  Notifications blocked. Click the lock icon in your browser address bar to allow.
                </p>
              ) : pushState === "granted" ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-emerald-400 font-medium">✓ Enabled</p>
                    <p className="text-xs text-slate-500 mt-0.5">You&apos;ll be notified about expenses and settlements</p>
                  </div>
                  <button
                    id="push-disable-btn"
                    onClick={unsubscribe}
                    disabled={pushLoading}
                    className="text-xs text-slate-500 hover:text-rose-400 transition-colors border border-slate-700 rounded-lg px-3 py-1.5"
                  >
                    Disable
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-300">Stay in the loop</p>
                    <p className="text-xs text-slate-500 mt-0.5">New expenses, settlement requests &amp; confirmations</p>
                  </div>
                  <button
                    id="push-enable-btn-profile"
                    onClick={subscribe}
                    disabled={pushLoading}
                    className="btn-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                  >
                    {pushLoading ? "…" : "Enable"}
                  </button>
                </div>
              )}
            </div>

            {/* Logout */}
            <button
              id="logout-btn"
              onClick={handleLogout}
              className="w-full rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3.5 text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors active:scale-[0.98]"
            >
              Sign out
            </button>

            <p className="text-center text-xs text-slate-700 pb-4">
              Spenit v0 · Free forever for core splitting
            </p>
          </div>
        ) : null}
      </main>
      <BottomNav />
    </>
  );
}
