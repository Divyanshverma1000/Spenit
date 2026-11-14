import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const onVercel = !!process.env.VERCEL;

// In production the browser talks to "/api" and Next.js proxies it to the real backend.
// Without BACKEND_URL that proxy would point at localhost and every request would 502,
// so fail the deploy loudly instead of shipping a broken app.
const backendUrl = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/+$/, "");
if (isProd && onVercel && !process.env.BACKEND_URL) {
  throw new Error(
    "BACKEND_URL is not set. Add it in Vercel → Project → Settings → Environment Variables " +
      "(e.g. https://spenit-backend.onrender.com) and redeploy."
  );
}

// If the app is built to call the API on another origin (NEXT_PUBLIC_API_URL), the policy
// below must allow it; on Vercel it is the same origin ("/api") and this stays empty.
const apiOrigin = (() => {
  try { return process.env.NEXT_PUBLIC_API_URL ? new URL(process.env.NEXT_PUBLIC_API_URL).origin : ""; } catch { return ""; }
})();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera is used by the QR scanner and receipt capture; everything else stays off.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(self)" }, // microphone: Speak on AI Expense
  // Required for the Google sign-in popup to report back to the page (removes the
  // "Cross-Origin-Opener-Policy policy would block the window.postMessage call" warning).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ...(isProd
    ? [
        // Browsers only ever use HTTPS for this site from now on.
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        // Where the page may load things from. The API is same-origin ("/api"); Google
        // sign-in needs its script, style and frame; avatars come from googleusercontent.
        // Next.js needs inline scripts/styles. Production only: dev tooling uses eval.
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client",
            "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
            `img-src 'self' data: blob: https://*.googleusercontent.com ${apiOrigin}`.trim(),
            "font-src 'self' data:",
            `connect-src 'self' https://accounts.google.com/gsi/ ${apiOrigin}`.trim(),
            "frame-src https://accounts.google.com/gsi/",
            "worker-src 'self'",
            "manifest-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            ...(apiOrigin.startsWith("http://") ? [] : ["upgrade-insecure-requests"]),
          ].join("; "),
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Lets a production build run alongside `next dev` without clobbering it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Which build someone is running (sent with problem reports). Vercel sets the commit.
  env: { NEXT_PUBLIC_APP_VERSION: (process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7) },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The service worker must never be served from a stale HTTP cache, or app updates stall.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
      {
        // Illustrations and icons rarely change: let phones keep them.
        source: "/illustrations/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
