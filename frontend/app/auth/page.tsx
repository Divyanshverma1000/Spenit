"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { useAuth } from "@/context/AuthContext";
import Image from "next/image";
import { Link, Sparkles, ShieldCheck, Shield } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function AuthPage() {
  const { login, isAuthenticated, initializing } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!initializing && isAuthenticated) router.replace("/dashboard");
  }, [isAuthenticated, initializing, router]);

  if (initializing) {
    return (
      <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center">
        <div className="spinner border-[var(--accent)]" />
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
    <main className="min-h-screen bg-[#F9FAFB] flex flex-col items-center p-6 sm:p-8 page-content relative overflow-x-hidden pb-32">
      {/* Container to restrict max width for desktop viewing, but optimized for mobile */}
      <div className="w-full max-w-md flex flex-col space-y-8 mt-4">
        
        {/* Logo */}
        <div className="flex justify-center w-full">
          <div className="relative w-48 h-16 sm:w-56 sm:h-20">
            <Image
              src="/App_logo.png"
              alt="Spenit Logo"
              fill
              className="object-contain"
              priority
            />
          </div>
        </div>

        {/* Hero Text */}
        <div className="text-left space-y-3 px-2">
          <h1 className="text-4xl sm:text-5xl font-[var(--font-display)] font-extrabold tracking-tight text-[#111827] leading-[1.1]">
            Split expenses effortlessly.<br/>
            <span className="text-[var(--accent)]">Settle with ease.</span>
          </h1>
          <p className="text-[#6B7280] text-[15px] sm:text-base font-[var(--font-body)] leading-relaxed max-w-[320px]">
            Track shared expenses, simplify settlements, and stay on top of every group, every time.
          </p>
        </div>

        {/* 3D Illustration */}
        <div className="relative w-full aspect-[4/3] flex justify-center items-center my-2">
          <Image
            src="/Spenit app expense-splitting overview.png"
            alt="Expense Splitting Illustration"
            fill
            className="object-contain drop-shadow-2xl"
            priority
          />
        </div>

        {/* Feature List */}
        <div className="flex flex-col space-y-6 px-2">
          {/* Feature 1 */}
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center">
              <Link className="text-[var(--accent)]" size={24} strokeWidth={2} />
            </div>
            <div className="flex flex-col pt-1">
              <h3 className="text-[#111827] font-bold text-base">Share in seconds</h3>
              <p className="text-[#6B7280] text-sm">Invite anyone with a link or QR</p>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center">
              <Sparkles className="text-[var(--accent)]" size={24} strokeWidth={2} />
            </div>
            <div className="flex flex-col pt-1">
              <h3 className="text-[#111827] font-bold text-base">AI makes it easy</h3>
              <p className="text-[#6B7280] text-sm">Add expenses using simple text or voice</p>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center">
              <ShieldCheck className="text-[var(--accent)]" size={24} strokeWidth={2} />
            </div>
            <div className="flex flex-col pt-1">
              <h3 className="text-[#111827] font-bold text-base">Secure & private</h3>
              <p className="text-[#6B7280] text-sm">Your data is yours, always</p>
            </div>
          </div>
        </div>

        {/* Pagination Dots (Decorative) */}
        <div className="flex justify-center items-center gap-2 py-4">
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-gray-200"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-gray-200"></div>
        </div>
      </div>

      {/* Sticky Bottom CTA Section */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-[#F9FAFB] via-[#F9FAFB] to-transparent pt-12 pb-6 px-6 sm:px-8 flex flex-col items-center justify-end z-50">
        <div className="w-full max-w-md flex flex-col items-center space-y-4">
          <div className="w-full overflow-hidden rounded-2xl relative shadow-xl shadow-orange-500/20 group hover:shadow-orange-500/30 transition-shadow">
            {/* We overlay the invisible GoogleLogin button over a custom beautiful button to match the mockup perfectly */}
            <div className="absolute inset-0 z-10 cursor-pointer" style={{ opacity: 0.01 }}>
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => console.error("Google sign-in failed")}
                theme="outline"
                size="large"
                text="continue_with"
                width="1000" // Make it very wide so it covers our custom button
              />
            </div>
            <div className="w-full bg-[var(--accent)] hover:bg-[#E67E22] transition-colors text-white font-semibold text-lg py-4 flex items-center justify-center gap-3">
              <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#FFFFFF" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#FFFFFF" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FFFFFF" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#FFFFFF" />
              </svg>
              Continue with Google
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[#6B7280] font-medium">
            <Shield size={14} />
            No password required
          </div>

          <p className="text-[10px] text-gray-400 font-medium tracking-wide">
            Free forever for core splitting • No ads • No hidden limits
          </p>
        </div>
      </div>
    </main>
  );
}
