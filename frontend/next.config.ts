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

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera is used by the QR scanner and receipt capture; everything else stays off.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(self)" },
  // Required for the Google sign-in popup to report back to the page (removes the
  // "Cross-Origin-Opener-Policy policy would block the window.postMessage call" warning).
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  // Lets a production build run alongside `next dev` without clobbering it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
