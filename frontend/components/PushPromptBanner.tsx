"use client";

import { useState } from "react";
import { usePushNotifications, needsIOSInstall } from "@/hooks/usePushNotifications";

interface PushPromptBannerProps {
  /** Rendered inline — shown at a contextual moment, never on page load */
  onDismiss?: () => void;
}

/**
 * PushPromptBanner — context-sensitive push permission prompt.
 *
 * When to show this (per ProductDetailIDEA.md §6 and Stage 7 spec):
 *   - After a user successfully adds their FIRST expense, or
 *   - After they successfully join a group for the first time.
 *   NOT on page load — users on iOS/Android reflexively dismiss those.
 *
 * Handles three cases:
 *   1. iOS, not installed to home screen → explains the iOS constraint
 *   2. Push already denied → short explanation, browser settings link
 *   3. Push available → "Enable notifications" button
 */
export default function PushPromptBanner({ onDismiss }: PushPromptBannerProps) {
  const { state, loading, subscribe } = usePushNotifications();
  const [dismissed, setDismissed] = useState(false);
  const [justEnabled, setJustEnabled] = useState(false);

  function dismiss() {
    setDismissed(true);
    onDismiss?.();
  }

  async function handleEnable() {
    const ok = await subscribe();
    if (ok) setJustEnabled(true);
  }

  if (dismissed || state === "unsupported") return null;

  // ── iOS: app not installed to home screen ──────────────────────────────────
  if (state === "ios-not-installed" || needsIOSInstall()) {
    return (
      <div className="mx-5 my-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">📱</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300 mb-1">
              Install Spenit to get notifications
            </p>
            <p className="text-xs text-amber-200/70 leading-relaxed">
              iOS requires the app to be installed to your home screen before push
              notifications work (iOS 16.4+ requirement). Tap{" "}
              <span className="font-semibold">Share →</span>{" "}
              <span className="font-semibold">Add to Home Screen</span> in Safari, then
              re-open the app from the home screen icon.
            </p>
          </div>
          <button
            onClick={dismiss}
            className="text-amber-400/60 hover:text-amber-300 text-lg leading-none ml-1 flex-shrink-0"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  // ── Permission denied ──────────────────────────────────────────────────────
  if (state === "denied") {
    return (
      <div className="mx-5 my-3 rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">🔕</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-300 mb-1">
              Notifications blocked
            </p>
            <p className="text-xs text-slate-500">
              You&apos;ve blocked notifications for this site. To re-enable, click the
              lock icon in your browser&apos;s address bar and allow notifications.
            </p>
          </div>
          <button onClick={dismiss} className="text-slate-600 hover:text-slate-400 text-lg leading-none flex-shrink-0">
            ×
          </button>
        </div>
      </div>
    );
  }

  // ── Already granted / just enabled ────────────────────────────────────────
  if (state === "granted" || justEnabled) {
    return (
      <div className="mx-5 my-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">🔔</span>
          <p className="flex-1 text-sm text-emerald-300 font-medium">
            Notifications enabled — you&apos;ll be notified about new expenses and settlements.
          </p>
          <button onClick={dismiss} className="text-emerald-500/60 hover:text-emerald-400 text-lg leading-none flex-shrink-0">
            ×
          </button>
        </div>
      </div>
    );
  }

  // ── Prompt to enable ──────────────────────────────────────────────────────
  return (
    <div className="mx-5 my-3 rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4 animate-in">
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0">🔔</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-violet-200 mb-1">
            Get notified instantly
          </p>
          <p className="text-xs text-slate-400 mb-3">
            Know the moment someone adds an expense or confirms your settlement —
            without refreshing the app.
          </p>
          <div className="flex gap-2">
            <button
              id="push-enable-btn"
              onClick={handleEnable}
              disabled={loading}
              className="btn-primary px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {loading ? "Setting up…" : "Enable notifications"}
            </button>
            <button
              onClick={dismiss}
              className="text-xs text-slate-500 hover:text-slate-400 px-2"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
