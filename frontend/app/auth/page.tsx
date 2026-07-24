"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/Card";
import { Link, Zap, Bot, CheckCircle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function AuthPage() {
  const { login, isAuthenticated, initializing } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!initializing && isAuthenticated) router.replace("/dashboard");
  }, [isAuthenticated, initializing, router]);

  if (initializing) {
    return (
      <div className="min-h-screen bg-[var(--ink)] flex items-center justify-center">
        <div className="spinner" />
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
      router.replace("/dashboard");
    } catch (err) {
      console.error("Auth error:", err);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--ink)] flex flex-col items-center justify-center p-6 page-content relative overflow-hidden">
      <div className="relative z-10 w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <h1 className="text-[32px] font-bold tracking-tight text-[var(--text-primary)] font-[var(--font-display)]">
            Spenit
          </h1>
          <p className="text-[var(--text-muted)] text-sm font-[var(--font-body)]">
            Split expenses · Settle with UPI · Zero friction
          </p>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-2">
          {[
            { label: "Share a link", icon: Link },
            { label: "Instant splits", icon: Zap },
            { label: "AI entry", icon: Bot },
            { label: "UPI settle", icon: CheckCircle }
          ].map((f) => (
            <span key={f.label} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] border border-[var(--border)] bg-[var(--paper)] rounded-[var(--radius-sm)] px-3 py-1.5">
              <f.icon size={14} strokeWidth={1.5} />
              {f.label}
            </span>
          ))}
        </div>

        {/* Sign-in card */}
        <Card padding="lg">
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1 text-center">Get started</h2>
          <p className="text-sm text-[var(--text-secondary)] text-center mb-7">
            Continue with Google — no password needed
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
          <p className="mt-5 text-center text-xs text-[var(--text-secondary)]">
            We only use your name and email for account creation.
          </p>
        </Card>

        {/* Tagline */}
        <p className="text-center text-xs text-[var(--text-muted)]">
          Free forever for core splitting · No ads · No artificial caps
        </p>
      </div>
    </main>
  );
}
