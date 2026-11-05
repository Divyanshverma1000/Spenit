"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { reportError } from "@/lib/errorReport";

/** The whole app failed to render (even the layout). Plain HTML only: no app styles here. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportError(error, "global");
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0F1115", color: "#F3F4F6", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 340, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Spenit hit a problem</h1>
          <p style={{ fontSize: 14, color: "#9CA3AF", margin: "0 0 20px" }}>Your data is safe. We&apos;ve been told. Try again in a moment.</p>
          <button onClick={() => retry()} style={{ padding: "12px 20px", borderRadius: 14, border: 0, background: "#F59E0B", color: "#fff", fontWeight: 700, fontSize: 14 }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
