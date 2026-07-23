"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { useAuth } from "@/context/AuthContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function AuthPage() {
  const { login, isAuthenticated, initializing } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!initializing && isAuthenticated) router.replace("/dashboard");
  }, [isAuthenticated, initializing, router]);

  // Don't flash the login form while checking the cookie
  if (initializing) {
    return (
      <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  async function handleGoogleSuccess(credentialResponse: CredentialResponse) {
    if (!credentialResponse.credential) return;
    try {
      const res = await fetch(`${API_URL}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ idToken: credentialResponse.credential }),
      });
      if (!res.ok) return;
      const data = await res.json();
      login(data.accessToken, data.user);
      router.replace("/dashboard"); // ← goes to dashboard, not profile
    } catch (err) {
      console.error("Auth error:", err);
    }
  }

  return (
    <main className="min-h-screen bg-[#0a0a12] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Ambient background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-fuchsia-600/15 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-3xl shadow-2xl shadow-violet-500/30 mb-4">
            ₹
          </div>
          <h1 className="text-5xl font-bold tracking-tight gradient-text">Spenit</h1>
          <p className="text-slate-400 text-sm">
            Split expenses · Settle with UPI · Zero friction
          </p>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2">
          {["🔗 Share a link", "⚡ Instant splits", "🤖 AI entry", "✅ UPI settle"].map((f) => (
            <span key={f} className="text-xs text-slate-400 border border-white/10 bg-white/5 rounded-full px-3 py-1">
              {f}
            </span>
          ))}
        </div>

        {/* Sign-in card */}
        <div className="glass-card p-8 shadow-2xl shadow-black/40">
          <h2 className="text-xl font-semibold text-white mb-1 text-center">Get started</h2>
          <p className="text-sm text-slate-400 text-center mb-7">
            Continue with Google — no password needed
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
          <p className="mt-5 text-center text-xs text-slate-600">
            We only use your name and email for account creation.
          </p>
        </div>

        {/* Tagline */}
        <p className="text-center text-xs text-slate-600">
          Free forever for core splitting · No ads · No artificial caps
        </p>
      </div>
    </main>
  );
}
