"use client";

import { API_URL } from "@/lib/api";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import BottomNav from "@/components/BottomNav";
import { SettingsList } from "@/components/ui/SettingsList";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { LogOut, User, Bell, Cpu, Key, CheckCircle, AlertCircle, Wallet, Edit2, Copy, Check, Lock, HelpCircle, FileText, Info, Trash2, RefreshCw, ShieldCheck } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Palette, Camera, Loader2, Download, UserX, CheckCircle2, XCircle } from "lucide-react";
import DeleteAccountSheet from "@/components/DeleteAccountSheet";
import FeedbackSheet from "@/components/FeedbackSheet";
import ExtraGroqKeys from "@/components/ExtraGroqKeys";
import MemberAvatar from "@/components/ui/MemberAvatar";
import { fileToSquareAvatar } from "@/lib/image";
import { notice, toast } from "@/lib/dialog";


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
  groqExtraKeysMasked?: string[];
  maxExtraGroqKeys?: number;
  /** owner accounts (ADMIN_EMAILS on the server) see the admin dashboard */
  isAdmin?: boolean;
}

export default function ProfilePage() {
  const authed = useRequireAuth();
  const { user, logout, accessToken, authFetch } = useAuth();
  const [showDelete, setShowDelete] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [exporting, setExporting] = useState(false);

  /** Download everything we hold about you as a JSON file. */
  async function downloadMyData() {
    setExporting(true);
    try {
      const res = await authFetch("/users/me/export");
      if (!res.ok) throw new Error();
      const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `spenit-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      toast("Couldn't download your data. Check your connection and try again.", "error");
    } finally {
      setExporting(false);
    }
  }
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
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  async function uploadPhoto(file: File | undefined) {
    if (!file || !accessToken) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const imageBase64 = await fileToSquareAvatar(file);
      const res = await fetch(`${API_URL}/users/me/photo`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't upload the photo");
      setProfile((p) => (p ? { ...p, avatarUrl: data.avatarUrl } : p));
    } catch (err) {
      setPhotoError((err as Error).message);
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function removePhoto() {
    if (!accessToken) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const res = await fetch(`${API_URL}/users/me/photo`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error("Couldn't remove the photo");
      setProfile((p) => (p ? { ...p, avatarUrl: null } : p));
    } catch (err) {
      setPhotoError((err as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  }

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
        toast("AI key saved");
      } else {
        const err = await res.json();
        toast(err.error || "Couldn't save the key", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Couldn't save the key. Check your connection.", "error");
    } finally {
      setIsSavingGroq(false);
    }
  }

  async function handleTestConnection() {
    if (!accessToken || !profile?.hasGroqKey) return;
    setTestingGroq(true);
    try {
      // Real requests to Groq from the server — text model and vision model separately.
      const res = await fetch(`${API_URL}/ai/test-key`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      type Ping = { ok: boolean; model: string; status?: number; message?: string; ms?: number };
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; text?: Ping; vision?: Ping } | null;
      const row = (label: string, p?: Ping) =>
        !p ? null : (
          <div className="flex items-start gap-3 py-2.5">
            {p.ok
              ? <CheckCircle2 size={18} className="text-[var(--positive)] flex-shrink-0 mt-0.5" />
              : <XCircle size={18} className="text-[var(--negative)] flex-shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[var(--text-primary)]">{label}</p>
              <p className="text-[12.5px] text-[var(--text-muted)] break-words">
                {p.model}{p.ok ? ` · ${p.ms} ms` : ` · ${p.status ? `HTTP ${p.status}: ` : ""}${p.message ?? "failed"}`}
              </p>
            </div>
          </div>
        );
      if (data?.text || data?.vision) {
        await notice({
          title: data.ok ? "Your AI key works" : "Connection problem",
          tone: data.ok ? "success" : "error",
          body: (
            <div className="mt-1 divide-y divide-[var(--hairline)]">
              {row("Text AI", data.text)}
              {row("Image AI", data.vision)}
            </div>
          ),
          confirmLabel: "Done",
        });
      } else {
        toast(data?.error || `Test failed (HTTP ${res.status})`, "error");
      }
    } catch (err) {
      console.error(err);
      toast("Couldn't test the connection. Check your internet.", "error");
    } finally {
      setTestingGroq(false);
    }
  }

  if (!authed || !user) return null;

  return (
    <>
      <main className="min-h-screen bg-[var(--ink)] page-content safe-area-pb pb-24">
        
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-[var(--ink)]/80 backdrop-blur-xl px-5 pt-14 pb-4 border-b border-[var(--hairline)]">
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
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoBusy}
                    aria-label="Change profile photo"
                    className="relative flex-shrink-0 active:scale-95 transition-transform"
                  >
                    <MemberAvatar person={{ id: profile.id, name: profile.name, avatarUrl: profile.avatarUrl }} size={56} />
                    <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[var(--accent)] text-white flex items-center justify-center border-2 border-[var(--paper)]">
                      {photoBusy ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} strokeWidth={2.5} />}
                    </span>
                  </button>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadPhoto(e.target.files?.[0])}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[var(--text-primary)] text-[18px] tracking-tight truncate">{profile.name}</p>
                    <p className="text-[var(--text-secondary)] text-[14px]">@{profile.username}</p>
                    <div className="flex gap-3 mt-1 text-[12px] font-bold">
                      <button onClick={() => photoInputRef.current?.click()} disabled={photoBusy} className="text-[var(--accent)]">
                        {profile.avatarUrl ? "Change photo" : "Add a photo"}
                      </button>
                      {profile.avatarUrl && (
                        <button onClick={removePhoto} disabled={photoBusy} className="text-[var(--text-muted)]">Remove</button>
                      )}
                    </div>
                  </div>
                </div>
                <p className="px-5 py-2.5 text-[12px] text-[var(--text-secondary)] bg-[var(--paper-dim)]">
                  {photoError ? <span className="text-[var(--negative)] font-medium">{photoError}</span> : "Your photo shows in groups. In each group you can also pick a fun avatar — tap your picture in the group's member list."}
                </p>
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
                        className="flex-1 bg-[var(--ink)] border border-[var(--hairline)] rounded-[12px] px-3 py-2 text-[14px] font-medium outline-none focus:ring-2 ring-[var(--accent-subtle)]"
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
                    <div className="bg-[var(--ink)] border border-[var(--hairline)] rounded-[12px] px-3 py-2.5 overflow-hidden flex items-center">
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
                <div className="flex flex-wrap items-center justify-between gap-3 w-full px-5 py-4 bg-white">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-[10px] bg-[var(--paper-dim)] text-[var(--text-primary)]"><Palette size={18} /></div>
                    <div className="text-[16px] font-semibold text-[var(--text-primary)] tracking-tight">Appearance</div>
                  </div>
                  <ThemeToggle className="w-full" />
                </div>
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
                    <span className={`inline-block h-[22px] w-[22px] transform rounded-full bg-[#FFFFFF] shadow-sm transition-transform ${isSubscribed ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
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
                        <h4 className="text-[14px] font-bold text-[var(--text-primary)]">Groq API Key</h4>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 leading-snug">Bring Your Own AI. Required for receipt scanning and intelligent chat.</p>
                      </div>
                    </div>
                  </div>

                  {isEditingGroq ? (
                    <form onSubmit={handleSaveGroq} className="flex gap-2 mb-3">
                      <div className="relative flex-1">
                        <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input
                          type="password"
                          value={groqKey}
                          onChange={(e) => setGroqKey(e.target.value)}
                          placeholder="gsk_..."
                          className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-main)] border border-[var(--hairline)] rounded-[12px] text-[13px] font-medium outline-none focus:border-[var(--accent)] transition-colors"
                          autoFocus
                        />
                      </div>
                      <button type="submit" disabled={isSavingGroq || !groqKey.trim()} className="bg-[var(--accent)] text-white px-4 rounded-[12px] font-bold text-[13px] shadow-sm disabled:opacity-50">
                        {isSavingGroq ? "..." : "Save"}
                      </button>
                    </form>
                  ) : profile.hasGroqKey ? (
                    <div className="flex items-center justify-between bg-[var(--bg-main)] border border-[var(--hairline)] rounded-[12px] px-3 py-2.5 mb-3">
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
                    <div className="bg-[var(--bg-main)] border border-[var(--hairline)] rounded-[12px] px-3 py-2.5 mb-3">
                      <span className="text-[13px] text-[var(--text-muted)] font-medium">No API Key configured</span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {profile.hasGroqKey && (
                      <button onClick={handleTestConnection} disabled={testingGroq} className="flex-1 bg-[var(--ink)] text-[var(--text-primary)] font-bold text-[12px] py-2 rounded-[10px] active:scale-95 transition-transform">
                        {testingGroq ? "Testing..." : "Test Connection"}
                      </button>
                    )}
                    {!profile.hasGroqKey && !isEditingGroq && (
                      <button onClick={() => setIsEditingGroq(true)} className="flex-1 bg-[var(--ink)] text-[var(--text-primary)] font-bold text-[12px] py-2 rounded-[10px] active:scale-95 transition-transform">
                        Set API Key
                      </button>
                    )}
                    <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="flex-1 bg-[var(--ink)] text-[var(--text-primary)] font-bold text-[12px] py-2 rounded-[10px] active:scale-95 transition-transform flex items-center justify-center gap-1">
                      Get Free Key
                    </a>
                  </div>

                  {profile.hasGroqKey && (
                    <ExtraGroqKeys
                      initial={profile.groqExtraKeysMasked ?? []}
                      max={profile.maxExtraGroqKeys ?? 4}
                      authFetch={authFetch}
                    />
                  )}
                </div>
              </SettingsList>
            </motion.div>

            {/* ── Settings ───────────────────────────────────────────────── */}
            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} className="mb-8">
              <SettingsList title="More Options">
                <SettingsRow icon={<HelpCircle size={18} />} label="Report a problem or share an idea" onClick={() => setShowFeedback(true)} />
                <SettingsRow icon={<CheckCircle size={18} />} label="Help test Spenit (checklist)" onClick={() => router.push("/testing")} />
                <SettingsRow icon={<Lock size={18} />} label="Privacy Policy" onClick={() => router.push("/privacy")} />
                <SettingsRow icon={<FileText size={18} />} label="Terms of Service" onClick={() => router.push("/terms")} />
                <SettingsRow icon={<Info size={18} />} label="About Spenit" onClick={() => router.push("/about")} />
                {profile?.isAdmin && (
                  <SettingsRow icon={<ShieldCheck size={18} />} label="Admin dashboard" onClick={() => router.push("/admin")} />
                )}
                <SettingsRow
                  icon={exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                  label="Download my data"
                  onClick={() => { if (!exporting) void downloadMyData(); }}
                />
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

            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }} className="mb-8">
              <SettingsList title="Account">
                <SettingsRow icon={<UserX size={18} />} label="Delete account" destructive onClick={() => setShowDelete(true)} />
              </SettingsList>
            </motion.div>

            <div className="text-center pb-6">
              <p className="text-[12px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Spenit · {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}</p>
              <p className="text-[12px] font-medium text-[var(--text-muted)] mt-1">Split fairly, stay friends</p>
            </div>

          </motion.div>
        ) : null}
      </main>
      {showFeedback && <FeedbackSheet from="/profile" onClose={() => setShowFeedback(false)} />}
      {showDelete && (
        <DeleteAccountSheet
          onClose={() => setShowDelete(false)}
          onDeleted={() => {
            try { localStorage.clear(); sessionStorage.clear(); } catch { /* private mode */ }
            logout();
            router.replace("/auth");
          }}
        />
      )}
      <BottomNav />
    </>
  );
}
