/**
 * sw.js — Spenit Web Push Service Worker
 *
 * Runs in the background, receives push events from the server, and shows
 * system-level notifications. Also handles notification clicks (navigates to
 * the relevant route).
 *
 * Architecture notes:
 *  - This file lives in /public so it is served at /sw.js (root scope).
 *  - The scope must be root so it can intercept all pushes for the app.
 *  - We do NOT use Workbox here — this is intentionally minimal. Caching and
 *    offline support is Stage 8; the only job of this SW in v0 is push.
 */

/* eslint-env serviceworker */
/* global self, clients */

self.addEventListener("install", (event) => {
  // Skip waiting so the new SW activates immediately on update
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  // Claim all open clients immediately
  event.waitUntil(self.clients.claim());
});

// ── Push event: show a notification ──────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Spenit", body: event.data.text(), url: "/dashboard" };
  }

  const title = payload.title || "Spenit";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/Spenit-icon-192.png",
    badge: "/Spenit-icon-192.png",
    tag: payload.tag || "spenit",
    data: { url: payload.url || "/dashboard" },
    requireInteraction: false,
    silent: false,
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open/focus the relevant route ─────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // If a Spenit tab is already open, focus it and navigate
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.focus();
            client.navigate(targetUrl);
            return;
          }
        }
        // No open tab — open a new one
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
