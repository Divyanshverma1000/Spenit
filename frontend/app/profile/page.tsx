"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { usePushNotifications, needsIOSInstall } from "@/hooks/usePushNotifications";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { Wallet, Bot, Bell, LogOut, Check } from "lucide-react";

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
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb pb-24">
        <PageHeader title="Settings" />

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="spinner" />
          </div>
        ) : profile ? (
          <div className="px-5 space-y-5 mt-4">
            
            {/* Profile Info */}
            <Card padding="md" className="flex items-center gap-4">
              <div className="relative flex-shrink-0">
                {profile.avatarUrl ? (
                  <Image src={profile.avatarUrl} alt={profile.name} width={56} height={56}
                    className="rounded-full ring-2 ring-[var(--border)]" />
                ) : (
                  <div className="h-14 w-14 rounded-full bg-[var(--paper-dim)] flex items-center justify-center text-xl font-bold text-[var(--accent)]">
                    {profile.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-[var(--positive)] ring-2 ring-[var(--paper)]" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-[var(--text-primary)] text-lg truncate">{profile.name}</p>
                <p className="text-[var(--text-secondary)] text-sm font-mono">@{profile.username}</p>
                <p className="text-[var(--text-muted)] text-xs truncate mt-0.5">{profile.email}</p>
              </div>
            </Card>

            {/* UPI ID */}
            <Card padding="md" className="space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Wallet size={20} strokeWidth={1.5} className="text-[var(--text-primary)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">UPI ID</h2>
                <span className="text-xs text-[var(--text-muted)]">(for receiving settlements)</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="yourname@upi"
                  value={upiId}
                  onChange={(e) => { setUpiId(e.target.value); setSavedUpi(false); }}
                  className="input-field flex-1"
                />
                <button
                  onClick={saveUpiId}
                  disabled={savingUpi}
                  className="btn-primary flex-shrink-0 px-4 disabled:opacity-50"
                >
                  {savingUpi ? "…" : savedUpi ? <Check size={16} /> : "Save"}
                </button>
              </div>
              {!profile.upiId && (
                <p className="text-xs text-[var(--negative)]">
                  Set your UPI ID so group members can generate a pre-filled payment link when settling with you.
                </p>
              )}
              {savedUpi && (
                <p className="text-xs text-[var(--positive)] flex items-center gap-1">
                  <Check size={14} /> UPI ID saved
                </p>
              )}
            </Card>

            {/* BYOK: Groq API Key */}
            <Card padding="md" className="space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Bot size={20} strokeWidth={1.5} className="text-[var(--accent)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Bring Your Own AI</h2>
                <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-xs text-[var(--accent)] hover:underline ml-auto">
                  Get a free key ↗
                </a>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Provide a <span className="font-semibold text-[var(--text-primary)]">Groq API Key</span> to enable voice entry and conversational ledger queries. Your key is stored securely.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder={profile.hasGroqKey && profile.groqKeyMasked ? profile.groqKeyMasked : "gsk_..."}
                  value={groqKey}
                  onChange={(e) => { setGroqKey(e.target.value); setSavedGroq(false); }}
                  className="input-field flex-1"
                />
                <button
                  onClick={saveGroqKey}
                  disabled={savingGroq || !groqKey}
                  className="btn-primary flex-shrink-0 px-4 disabled:opacity-50"
                >
                  {savingGroq ? "…" : savedGroq ? <Check size={16} /> : profile.hasGroqKey ? "Update" : "Save"}
                </button>
              </div>
              {!profile.hasGroqKey && (
                <p className="text-xs text-[var(--text-secondary)]">
                  AI features are disabled until you provide a key.
                </p>
              )}
              {savedGroq && (
                <p className="text-xs text-[var(--positive)] flex items-center gap-1">
                  <Check size={14} /> API Key saved — AI features unlocked!
                </p>
              )}
            </Card>

            {/* Notifications */}
            <Card padding="md">
              <div className="flex items-center gap-2 mb-3">
                <Bell size={20} strokeWidth={1.5} className="text-[var(--text-primary)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Notifications</h2>
              </div>
              {needsIOSInstall() ? (
                <div className="rounded-[var(--radius-sm)] bg-[var(--paper-dim)] p-3">
                  <p className="text-xs text-[var(--text-primary)] font-medium mb-1">Install to home screen required</p>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    iOS requires the app to be installed to your home screen before push notifications work (iOS 16.4+).
                    In Safari, tap <strong>Share → Add to Home Screen</strong>, then open from the home screen.
                  </p>
                </div>
              ) : pushState === "denied" ? (
                <p className="text-xs text-[var(--text-secondary)]">
                  Notifications blocked. Click the lock icon in your browser address bar to allow.
                </p>
              ) : pushState === "granted" ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--positive)] font-medium flex items-center gap-1">
                      <Check size={14} /> Enabled
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">You'll be notified about expenses</p>
                  </div>
                  <button
                    id="push-disable-btn"
                    onClick={unsubscribe}
                    disabled={pushLoading}
                    className="btn-secondary px-3 py-1.5 text-xs"
                  >
                    Disable
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-[var(--text-primary)] font-medium">Stay in the loop</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">New expenses & settlement requests</p>
                  </div>
                  <button
                    id="push-enable-btn-profile"
                    onClick={subscribe}
                    disabled={pushLoading}
                    className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {pushLoading ? "…" : "Enable"}
                  </button>
                </div>
              )}
            </Card>

            {/* Account Info */}
            <SectionLabel>Account Info</SectionLabel>
            <Card padding="none">
              <div className="divide-y divide-[var(--border)]">
                {[
                  { label: "Username", value: `@${profile.username}` },
                  { label: "Member since", value: new Date(profile.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "long" }) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between p-4">
                    <span className="text-sm text-[var(--text-secondary)]">{label}</span>
                    <span className="text-sm text-[var(--text-primary)] font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Logout */}
            <button
              id="logout-btn"
              onClick={handleLogout}
              className="btn-secondary w-full py-3.5 flex items-center justify-center gap-2 mt-4 text-[var(--negative)] hover:text-[var(--negative)]"
            >
              <LogOut size={18} strokeWidth={1.5} />
              Sign out
            </button>

            <p className="text-center text-xs text-[var(--text-muted)] pb-4 pt-2">
              Spenit v0 · Free forever for core splitting
            </p>
          </div>
        ) : null}
      </main>
      <BottomNav />
    </>
  );
}
