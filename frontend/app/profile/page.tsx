"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { SettingsList } from "@/components/ui/SettingsList";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { LogOut, User, Bell, Cpu, Key, CheckCircle, AlertCircle, Wallet, Edit2, Copy, Check, Lock, HelpCircle, FileText, Info, Trash2, RefreshCw, ShieldCheck } from "lucide-react";
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
  const [loading, setLoading] = useState(true);

  // UPI Edit State
  const [isEditingUpi, setIsEditingUpi] = useState(false);
  const [savingUpi, setSavingUpi] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);

  // AI Provider State
  const [isEditingGroq, setIsEditingGroq] = useState(false);
  const [isSavingGroq, setIsSavingGroq] = useState(false);
  const [testingGroq, setTestingGroq] = useState(false);
  const [copiedGroq, setCopiedGroq] = useState(false);

  // Push Notifications
  const { state: pushState, subscribe, unsubscribe } = usePushNotifications();
  const isSubscribed = pushState === "granted";

  const upiInputRef = useRef<HTMLInputElement>(null);

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

  async function handleSaveUpi() {
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
        setIsEditingUpi(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingUpi(false);
    }
  }

  async function handleSaveGroq(e?: React.FormEvent) {
    if (e) e.preventDefault();
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
        setIsEditingGroq(false);
        alert("API Key updated");
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

  async function handleTestConnection() {
    if (!accessToken || !profile?.hasGroqKey) return;
    setTestingGroq(true);
    try {
      const res = await fetch(`${API_URL}/ai/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: "test", question: "test" })
      });
      const data = await res.json();
      if (data.error === "missing_key") {
        alert("API key is invalid or missing.");
      } else {
        alert("✅ Connection successful!");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to test connection.");
    } finally {
      setTestingGroq(false);
    }
  }

  if (!authed || !user) return null;

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb pb-24">
        
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-[var(--ink)]/80 backdrop-blur-xl px-5 pt-14 pb-4 border-b border-[rgba(0,0,0,0.03)]">
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
            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} className="mb-6">
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
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[var(--text-primary)] text-[18px] tracking-tight truncate">{profile.name}</p>
                    <p className="text-[var(--text-secondary)] text-[14px]">@{profile.username}</p>
                  </div>
                </div>
                <SettingsRow icon={<User size={18} />} label="Email" value={profile.email} />
                <SettingsRow icon={<CheckCircle size={18} className="text-[var(--text-muted)]" />} label="Member since" value={new Date(profile.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "short" })} />
              </SettingsList>
            </motion.div>

            {/* ── UPI Section ──────────────────────────────────────────────── */}
            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} className="mb-6">
              <SettingsList title="Settlement Details">
                <div className="bg-white p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Wallet size={18} className="text-[var(--text-primary)]" />
                      <span className="text-[15px] font-semibold text-[var(--text-primary)]">UPI ID</span>
                    </div>
                    {!isEditingUpi && (
                      <div className="flex gap-2">
                        <button 
                          onClick={async () => {
                            await navigator.clipboard.writeText(profile.upiId || "");
                            setCopiedUpi(true); setTimeout(() => setCopiedUpi(false), 2000);
                          }}
                          className="p-1.5 bg-[var(--paper-dim)] rounded-md text-[var(--text-secondary)] active:scale-95 transition-transform"
                        >
                          {copiedUpi ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                        <button 
                          onClick={() => { setIsEditingUpi(true); setTimeout(() => upiInputRef.current?.focus(), 50); }}
                          className="p-1.5 bg-[var(--paper-dim)] rounded-md text-[var(--text-secondary)] active:scale-95 transition-transform"
                        >
                          <Edit2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {isEditingUpi ? (
                    <div className="flex gap-2">
                      <input 
                        ref={upiInputRef}
                        type="text"
                        value={upiId}
                        onChange={(e) => setUpiId(e.target.value)}
                        placeholder="yourname@upi"
                        className="flex-1 bg-[var(--ink)] border border-[rgba(0,0,0,0.05)] rounded-[12px] px-3 py-2 text-[14px] font-medium outline-none focus:ring-2 ring-[var(--accent-subtle)]"
                      />
                      <button 
                        onClick={handleSaveUpi}
                        disabled={savingUpi}
                        className="bg-[var(--accent)] text-white font-bold text-[13px] px-4 rounded-[12px] shadow-sm disabled:opacity-50"
                      >
                        {savingUpi ? "..." : "Save"}
                      </button>
                    </div>
                  ) : (
                    <div className="bg-[var(--ink)] border border-[rgba(0,0,0,0.05)] rounded-[12px] px-3 py-2.5 overflow-hidden flex items-center">
                      <div className="w-full overflow-hidden whitespace-nowrap">
                        {profile.upiId ? (
                          <div className="inline-block animate-marquee hover:paused active:paused font-mono text-[14px] font-medium text-[var(--text-primary)] w-full">
                            <span className="mr-8">{profile.upiId}</span>
                            <span>{profile.upiId}</span>
                          </div>
                        ) : (
                          <span className="text-[14px] text-[var(--text-muted)] font-medium">No UPI ID set</span>
                        )}
                      </div>
                    </div>
                  )}
                  <p className="text-[12px] text-[var(--text-secondary)] mt-2">
                    This UPI ID is used to receive settlement payments from group members.
                  </p>
                </div>
              </SettingsList>
            </motion.div>

            {/* ── Notifications ───────────────────────────────────────────────── */}
            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} className="mb-6">
              <SettingsList title="Preferences">
                <div className="flex items-center justify-between w-full px-5 py-4 bg-white">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-[10px] bg-[var(--paper-dim)] text-[var(--text-primary)]"><Bell size={18} /></div>
                    <div>
                      <div className="text-[16px] font-semibold text-[var(--text-primary)] tracking-tight">Push Notifications</div>
                      <div className="text-[12px] text-[var(--text-secondary)]">Get alerts for new expenses</div>
                    </div>
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

            {/* ── AI Provider ───────────────────────────────────────────────── */}
            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} className="mb-6">
              <SettingsList title="AI Assistant">
                <div className="bg-white p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-[12px] bg-black text-white shadow-sm">
                        <Cpu size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-[16px] font-bold text-[var(--text-primary)] tracking-tight">Groq</p>
                          {profile.hasGroqKey && !isEditingGroq && (
                            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--positive)] bg-green-50 px-2 py-0.5 rounded-[6px]">
                              <CheckCircle size={10} /> Connected
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] font-medium text-[var(--text-secondary)] mt-0.5">Model: Llama 3 8B Instruct</p>
                      </div>
                    </div>
                  </div>

                  {isEditingGroq ? (
                    <form onSubmit={handleSaveGroq} className="flex gap-2 mb-3">
                      <div className="relative flex-1">
                        <Key size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input
                          type="password"
                          placeholder="gsk_..."
                          value={groqKey}
                          onChange={(e) => setGroqKey(e.target.value)}
                          className="w-full bg-[var(--ink)] rounded-[12px] pl-9 pr-3 py-2 text-[14px] text-[var(--text-primary)] border border-[rgba(0,0,0,0.05)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-subtle)] font-mono"
                        />
                      </div>
                      <button type="submit" disabled={isSavingGroq || !groqKey.trim()} className="bg-[var(--accent)] text-white px-4 rounded-[12px] font-bold text-[13px] shadow-sm disabled:opacity-50">
                        {isSavingGroq ? "..." : "Save"}
                      </button>
                    </form>
                  ) : profile.hasGroqKey ? (
                    <div className="flex items-center justify-between bg-[var(--ink)] border border-[rgba(0,0,0,0.05)] rounded-[12px] px-3 py-2.5 mb-3">
                      <code className="font-mono text-[13px] font-medium text-[var(--text-secondary)]">{profile.groqKeyMasked}</code>
                      <div className="flex gap-2">
                        <button onClick={() => setCopiedGroq(true)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                          {copiedGroq ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                        <button onClick={() => setIsEditingGroq(true)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                          <Edit2 size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[var(--ink)] border border-[rgba(0,0,0,0.05)] rounded-[12px] px-3 py-2.5 mb-3">
                      <span className="text-[13px] text-[var(--text-muted)] font-medium">No API Key configured</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {profile.hasGroqKey && (
                      <button onClick={handleTestConnection} disabled={testingGroq} className="flex-1 bg-[var(--paper-dim)] text-[var(--text-primary)] font-bold text-[12px] py-2 rounded-[10px] active:scale-95 transition-transform">
                        {testingGroq ? "Testing..." : "Test Connection"}
                      </button>
                    )}
                    {!profile.hasGroqKey && !isEditingGroq && (
                      <button onClick={() => setIsEditingGroq(true)} className="flex-1 bg-[var(--paper-dim)] text-[var(--text-primary)] font-bold text-[12px] py-2 rounded-[10px] active:scale-95 transition-transform">
                        Set API Key
                      </button>
                    )}
                    <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="flex-1 bg-[var(--paper-dim)] text-[var(--text-primary)] font-bold text-[12px] py-2 rounded-[10px] active:scale-95 transition-transform flex items-center justify-center gap-1">
                      Get Free Key
                    </a>
                  </div>
                </div>
              </SettingsList>
            </motion.div>

            {/* ── Settings ───────────────────────────────────────────────── */}
            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} className="mb-8">
              <SettingsList title="More Options">
                <SettingsRow icon={<Lock size={18} />} label="Privacy" onClick={() => alert("Privacy coming soon")} />
                <SettingsRow icon={<ShieldCheck size={18} />} label="Security" onClick={() => alert("Security coming soon")} />
                <SettingsRow icon={<HelpCircle size={18} />} label="Help & Support" onClick={() => alert("Help coming soon")} />
                <SettingsRow icon={<FileText size={18} />} label="Terms of Service" onClick={() => alert("Terms coming soon")} />
                <SettingsRow icon={<Info size={18} />} label="About Spenit" onClick={() => alert("About coming soon")} />
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

            <div className="text-center pb-6">
              <p className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Spenit v1.0</p>
              <p className="text-[12px] font-medium text-[var(--text-muted)] mt-1">Premium Fintech Interface</p>
            </div>

          </motion.div>
        ) : null}
      </main>
      <BottomNav />
    </>
  );
}
