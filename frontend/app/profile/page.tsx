"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { SettingsList } from "@/components/ui/SettingsList";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { LogOut, User, Bell, Cpu, Key, CheckCircle, AlertCircle, Wallet } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

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
  const { user, logout, accessToken } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [upiId, setUpiId] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [savingUpi, setSavingUpi] = useState(false);
  const [isSavingGroq, setIsSavingGroq] = useState(false);
  const [loading, setLoading] = useState(true);

  // Push Notifications
  const { state: pushState, subscribe, unsubscribe } = usePushNotifications();
  const isSubscribed = pushState === "granted";

  useEffect(() => {
    if (!accessToken) return;
    fetch(`${API_URL}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => res.json())
      .then((data: UserProfile) => {
        setProfile(data);
        setUpiId(data.upiId || "");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accessToken]);

  async function saveUpiId(e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) {
    if (e.type === "keydown" && (e as React.KeyboardEvent).key !== "Enter") return;
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
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingUpi(false);
    }
  }

  async function handleSaveGroq(e: React.FormEvent) {
    e.preventDefault();
    if (!groqKey.trim() || !accessToken) return;
    
    setIsSavingGroq(true);
    try {
      const res = await fetch(`${API_URL}/users/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ groqApiKey: groqKey }),
      });
      if (res.ok) {
        setProfile((p) => p ? { ...p, hasGroqKey: true, groqKeyMasked: `gsk_***${groqKey.slice(-4)}` } : p);
        setGroqKey("");
        alert("Groq API Key updated successfully");
      } else {
        const err = await res.json();
        alert(err.error || "Failed to save key");
      }
    } catch (err) {
      console.error(err);
      alert("Error saving key");
    } finally {
      setIsSavingGroq(false);
    }
  }

  if (!authed || !user) return null;

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb pb-24">
        
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-[var(--ink)]/80 backdrop-blur-xl px-6 pt-16 pb-4 border-b border-[rgba(0,0,0,0.03)]">
          <h1 className="text-[28px] font-bold text-[var(--text-primary)] tracking-tight">
            Settings
          </h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="spinner" />
          </div>
        ) : profile ? (
          <motion.div 
            className="px-5 mt-6"
            initial="hidden"
            animate="show"
            variants={{
              hidden: { opacity: 0 },
              show: { opacity: 1, transition: { staggerChildren: 0.05 } }
            }}
          >
            
            {/* ── Profile Info ──────────────────────────────────────────────── */}
            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}>
              <SettingsList title="Account">
                <div className="px-5 py-4 bg-white flex items-center gap-4 border-b border-[var(--paper-dim)]">
                  <div className="relative flex-shrink-0">
                    {profile.avatarUrl ? (
                      <Image src={profile.avatarUrl} alt={profile.name} width={56} height={56}
                        className="rounded-full border border-[rgba(0,0,0,0.05)]" />
                    ) : (
                      <div className="h-14 w-14 rounded-full bg-[var(--paper-dim)] flex items-center justify-center text-[18px] font-bold text-[var(--accent)]">
                        {profile.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-[var(--text-primary)] text-[18px] tracking-tight truncate">{profile.name}</p>
                    <p className="text-[var(--text-secondary)] text-[14px]">@{profile.username}</p>
                  </div>
                </div>
                <SettingsRow 
                  icon={<User size={18} />} 
                  label="Email" 
                  value={profile.email} 
                />
                <SettingsRow 
                  icon={<Wallet size={18} />} 
                  label="UPI ID" 
                  value={
                    <input 
                      type="text" 
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      onBlur={saveUpiId}
                      onKeyDown={saveUpiId}
                      placeholder="Add UPI ID..."
                      className="text-right bg-transparent border-none outline-none focus:ring-0 text-[15px] font-medium placeholder-[var(--text-muted)] w-32 md:w-auto"
                    />
                  }
                />
              </SettingsList>
            </motion.div>

            {/* ── Preferences ───────────────────────────────────────────────── */}
            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}>
              <SettingsList title="Preferences">
                <div className="flex items-center justify-between w-full px-5 py-4 bg-white">
                  <div className="flex items-center gap-3">
                    <div className="text-[var(--accent)]"><Bell size={18} /></div>
                    <div className="text-[16px] font-medium text-[var(--text-primary)]">Push Notifications</div>
                  </div>
                  <button
                    onClick={isSubscribed ? unsubscribe : subscribe}
                    className={`relative inline-flex h-[26px] w-[46px] items-center rounded-full transition-colors ${isSubscribed ? 'bg-[var(--positive)]' : 'bg-[#E5E5EA]'}`}
                  >
                    <span className={`inline-block h-[22px] w-[22px] transform rounded-full bg-white shadow-sm transition-transform ${isSubscribed ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
                  </button>
                </div>
              </SettingsList>
            </motion.div>

            {/* ── AI Features ───────────────────────────────────────────────── */}
            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}>
              <SettingsList title="AI Provider (Groq)">
                <div className="px-5 py-4 bg-white flex flex-col gap-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-[12px] bg-orange-50 text-[var(--accent)]">
                        <Cpu size={20} />
                      </div>
                      <div>
                        <p className="text-[15px] font-bold text-[var(--text-primary)]">Llama 3 8B Instruct</p>
                        <p className="text-[12px] font-medium text-[var(--text-secondary)] mt-0.5 flex items-center gap-1">
                          {profile.hasGroqKey ? (
                            <><CheckCircle size={12} className="text-[var(--positive)]" /> Connected</>
                          ) : (
                            <><AlertCircle size={12} className="text-[var(--negative)]" /> Missing API Key</>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleSaveGroq} className="flex gap-2 mt-1">
                    <div className="relative flex-1">
                      <Key size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                      <input
                        type="password"
                        placeholder={profile.hasGroqKey ? profile.groqKeyMasked! : "Enter Groq API Key..."}
                        value={groqKey}
                        onChange={(e) => setGroqKey(e.target.value)}
                        className="w-full bg-[var(--ink)] rounded-xl pl-9 pr-4 py-2.5 text-[14px] text-[var(--text-primary)] border border-[rgba(0,0,0,0.05)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)] placeholder:text-[var(--text-muted)] font-mono"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSavingGroq || !groqKey.trim()}
                      className="bg-[var(--accent)] text-white px-5 rounded-xl font-bold text-[14px] disabled:opacity-50 hover:bg-[#E67E22] transition-colors"
                    >
                      {isSavingGroq ? "..." : "Save"}
                    </button>
                  </form>
                </div>
              </SettingsList>
            </motion.div>

            {/* ── Danger Zone ───────────────────────────────────────────────── */}
            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}>
              <SettingsList>
                <SettingsRow 
                  icon={<LogOut size={18} />} 
                  label="Log Out" 
                  destructive 
                  onClick={() => {
                    logout();
                    router.push("/auth");
                  }}
                />
              </SettingsList>
            </motion.div>

            <p className="text-center text-xs text-[var(--text-muted)] pb-6 pt-2 font-medium">
              Spenit v1.0 · Premium PWA
            </p>

          </motion.div>
        ) : null}
      </main>
      <BottomNav />
    </>
  );
}
