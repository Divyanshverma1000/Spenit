/**
 * sw.js — Spenit service worker.
 *
 *  1. Web Push: shows notifications and opens the right screen on click.
 *  2. Offline / speed: caches the app shell so the installed app opens instantly
 *     and keeps working with no network.
 *
 * Caching is only switched on for production builds (the page registers this file
 * as /sw.js?cache=1&v=N there). In development it stays push-only so dev chunks
 * are never served stale.
 *
 * Strategies
 *   /_next/static/*, fonts, icons, images  cache-first   (content-hashed, immutable)
 *   page navigations + Next RSC fetches    stale-while-revalidate (instant, refreshed behind the scenes)
 *   API calls / other origins              not touched   (data caching lives in the app: React Query + IndexedDB)
 *
 * Bump VERSION to drop all old caches on the next activation.
 */

/* eslint-env serviceworker */
/* global self, clients, caches */

const VERSION = "v2";
const STATIC_CACHE = `spenit-static-${VERSION}`;
const PAGE_CACHE = `spenit-pages-${VERSION}`;
const KNOWN_CACHES = [STATIC_CACHE, PAGE_CACHE];
const CACHING = new URL(self.location.href).searchParams.get("cache") === "1";
const MAX_PAGES = 60;

// Screens worth having ready the very first time the app is installed.
const PRECACHE_PAGES = ["/dashboard", "/groups", "/profile"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      if (CACHING) {
        const cache = await caches.open(PAGE_CACHE);
        await Promise.allSettled(PRECACHE_PAGES.map((url) => cache.add(url)));
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("spenit-") && !KNOWN_CACHES.includes(n)).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
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
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192.png",
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

// ── Fetch: app-shell caching ──────────────────────────────────────────────────

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spenit — offline</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#F9FAFB;color:#1F2937;text-align:center;padding:24px}
@media(prefers-color-scheme:dark){body{background:#0E1014;color:#F1F3F6}}
button{margin-top:16px;padding:12px 20px;border:0;border-radius:14px;background:#F59E0B;color:#fff;font-weight:600;font-size:15px}
p{color:#6B7280;max-width:28ch;margin:8px auto 0}</style></head>
<body><div><h1 style="margin:0">You're offline</h1>
<p>This screen hasn't been saved on your phone yet. Open it once while online and it will work offline next time.</p>
<button onclick="location.reload()">Try again</button></div></body></html>`;

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(PAGE_CACHE);
  // Ignore the cache-busting query on Next RSC requests so repeat visits hit the cache.
  const cacheKey = request;
  const hit = await cache.match(cacheKey);

  const network = fetch(request)
    .then((res) => {
      if (res.ok) {
        cache.put(cacheKey, res.clone()).then(() => trimCache(PAGE_CACHE, MAX_PAGES));
      }
      return res;
    })
    .catch(() => null);

  if (hit) {
    event.waitUntil(network); // refresh in the background
    return hit;
  }
  const res = await network;
  if (res) return res;
  return null;
}

self.addEventListener("fetch", (event) => {
  if (!CACHING) return; // dev: let the browser handle everything

  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Google sign-in, API host, etc.
  if (url.pathname.startsWith("/api/")) return; // data is cached by the app, not here

  // Immutable build output, fonts, icons
  if (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:woff2?|png|jpg|jpeg|svg|ico|webp|avif)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request).catch(() => fetch(request)));
    return;
  }

  // Screens: HTML navigations and Next's RSC payload fetches
  const isNavigation = request.mode === "navigate";
  const isRsc = url.searchParams.has("_rsc") || request.headers.get("RSC") === "1";
  if (isNavigation || isRsc) {
    event.respondWith(
      (async () => {
        const res = await staleWhileRevalidate(request, event);
        if (res) return res;
        if (isNavigation) {
          return new Response(OFFLINE_HTML, {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        return Response.error();
      })()
    );
  }
});
