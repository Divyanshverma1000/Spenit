"use client";

import { useState } from "react";
import { usePushNotifications, needsIOSInstall } from "@/hooks/usePushNotifications";
import { Bell, BellOff, Smartphone, X } from "lucide-react";

interface PushPromptBannerProps {
  /** Rendered inline — shown at a contextual moment, never on page load */
  onDismiss?: () => void;
}

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
      <div className="mx-5 my-3 p-5 card">
        <div className="flex items-start gap-3">
          <Smartphone className="h-6 w-6 flex-shrink-0 text-[var(--text-primary)]" strokeWidth={1.5} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
              Install Spenit to get notifications
            </p>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              iOS requires the app to be installed to your home screen before push
              notifications work. Tap{" "}
              <span className="font-semibold text-[var(--text-primary)]">Share → Add to Home Screen</span>{" "}
              in Safari, then re-open the app from the home screen icon.
            </p>
          </div>
          <button
            onClick={dismiss}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-1 flex-shrink-0 transition-colors"
          >
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    );
  }

  // ── Permission denied ──────────────────────────────────────────────────────
  if (state === "denied") {
    return (
      <div className="mx-5 my-3 p-5 card">
        <div className="flex items-start gap-3">
          <BellOff className="h-6 w-6 flex-shrink-0 text-[var(--negative)]" strokeWidth={1.5} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
              Notifications blocked
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              You&apos;ve blocked notifications for this site. To re-enable, click the
              lock icon in your browser&apos;s address bar and allow notifications.
            </p>
          </div>
          <button onClick={dismiss} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0 transition-colors">
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    );
  }

  // ── Already granted / just enabled ────────────────────────────────────────
  if (state === "granted" || justEnabled) {
    return (
      <div className="mx-5 my-3 p-5 card">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-[var(--positive)]" strokeWidth={1.5} />
          <p className="flex-1 text-sm text-[var(--text-primary)] font-medium">
            Notifications enabled — you&apos;ll be notified about new expenses and settlements.
          </p>
          <button onClick={dismiss} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex-shrink-0 transition-colors">
            <X className="h-5 w-5" strokeWidth={1.5} />
          </button>
        </div>
      </div>
    );
  }

  // ── Prompt to enable ──────────────────────────────────────────────────────
  return (
    <div className="mx-5 my-3 border-l-[3px] border-l-[var(--accent)] p-5 card animate-in">
      <div className="flex items-start gap-3">
        <Bell className="h-6 w-6 flex-shrink-0 text-[var(--accent)]" strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
            Get notified instantly
          </p>
          <p className="text-xs text-[var(--text-secondary)] mb-3">
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
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
