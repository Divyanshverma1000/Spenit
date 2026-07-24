"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

/**
 * Converts a base64url VAPID public key to a Uint8Array.
 * Required by PushManager.subscribe({ applicationServerKey }).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

// ── iOS detection ──────────────────────────────────────────────────────────────

/** True if running on iOS (iPhone/iPad) */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * True if the app is installed to the iOS home screen (standalone mode).
 * On iOS 16.4+, push notifications only work in standalone mode.
 */
function isIOSStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * True if iOS push would work — either we're in standalone mode, or we're not on iOS at all.
 * This is the definitive check before attempting subscription.
 */
export function canReceivePush(): boolean {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (isIOS() && !isIOSStandalone()) return false; // iOS requires standalone
  return true;
}

/** True if the user is on iOS and hasn't installed to home screen yet */
export function needsIOSInstall(): boolean {
  return isIOS() && !isIOSStandalone();
}

// ── Permission states ──────────────────────────────────────────────────────────

export type PushState =
  | "unsupported"    // browser doesn't support push
  | "ios-not-installed" // iOS but not in standalone mode
  | "prompt"         // permission not yet asked
  | "granted"        // subscribed
  | "denied"         // user explicitly blocked notifications
  | "error";         // something else went wrong

// ── usePushNotifications hook ──────────────────────────────────────────────────

export function usePushNotifications() {
  const { accessToken } = useAuth();
  const [state, setState] = useState<PushState>("prompt");
  const [loading, setLoading] = useState(false);

  // Determine initial state without asking for permission
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (needsIOSInstall()) {
      setState("ios-not-installed");
      return;
    }
    // Check existing permission state
    if (Notification.permission === "granted") {
      setState("granted");
    } else if (Notification.permission === "denied") {
      setState("denied");
    } else {
      setState("prompt");
    }
  }, []);

  /**
   * Subscribe to push notifications.
   * 1. Request notification permission
   * 2. Register service worker if needed
   * 3. Subscribe via PushManager
   * 4. POST subscription to backend
   */
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!accessToken) return false;
    if (!canReceivePush()) return false;
    if (!VAPID_PUBLIC_KEY) {
      console.warn("[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set");
      return false;
    }

    setLoading(true);
    try {
      // 1. Register (or get existing) service worker
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      // 2. Subscribe via PushManager
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, // required by spec
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as any,
      });

      // 3. Send subscription to backend
      const subJson = subscription.toJSON();
      const res = await fetch(`${API_URL}/push/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          expirationTime: subJson.expirationTime,
        }),
        credentials: "include",
      });

      if (res.ok) {
        setState("granted");
        return true;
      } else {
        setState("error");
        return false;
      }
    } catch (err) {
      console.warn("[push] subscribe failed:", err);
      if (Notification.permission === "denied") {
        setState("denied");
      } else {
        setState("error");
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  /**
   * Unsubscribe from push notifications.
   */
  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!accessToken) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      if (!registration) return;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return;
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await fetch(`${API_URL}/push/subscribe`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ endpoint }),
      });
      setState("prompt");
    } catch (err) {
      console.warn("[push] unsubscribe failed:", err);
    }
  }, [accessToken]);

  return { state, loading, subscribe, unsubscribe };
}
