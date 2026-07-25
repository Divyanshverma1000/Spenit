"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/Card";
import { Link, Zap, Bot, CheckCircle } from "lucide-react";

import Image from "next/image";

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
      {/* Decorative background blur */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[var(--brand-primary)] opacity-10 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm flex flex-col justify-center min-h-[80vh] space-y-10">
        {/* Premium Text Logo Integration */}
        <div className="flex flex-col items-center space-y-4 pt-8">
          <div className="relative w-56 h-20 sm:w-64 sm:h-24 drop-shadow-lg">
            <Image
              src="/Spenit-logo-withText.png"
              alt="Spenit Logo"
              fill
              className="object-contain"
              priority
            />
          </div>
          <p className="text-[var(--text-muted)] text-sm sm:text-base font-[var(--font-body)] max-w-[250px] mx-auto text-center leading-relaxed">
            Split expenses effortlessly. Settle with UPI.
          </p>
        </div>

        {/* Minimal Feature Pills */}
        <div className="flex flex-wrap justify-center gap-2 px-4">
          {[
            { label: "Share link", icon: Link },
            { label: "AI entry", icon: Bot },
            { label: "UPI settle", icon: CheckCircle }
          ].map((f) => (
            <span key={f.label} className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] border border-[var(--border)] bg-[var(--surface)]/50 backdrop-blur-sm rounded-full px-3.5 py-1.5 shadow-sm">
              <f.icon size={13} strokeWidth={2} className="text-[var(--brand-primary)]" />
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
