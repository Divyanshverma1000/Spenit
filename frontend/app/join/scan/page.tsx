"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Scanner } from "@yudiel/react-qr-scanner";
import { ChevronLeft, QrCode, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useRequireAuth } from "@/hooks/useRequireAuth";

export default function QRScanJoinPage() {
  const router = useRouter();
  const authed = useRequireAuth();
  const [error, setError] = useState<string | null>(null);

  const handleScan = (text: string) => {
    try {
      // The QR code contains the invite URL: https://spenit.vercel.app/g/token
      if (text.includes("/g/")) {
        const parts = text.split("/g/");
        if (parts.length === 2) {
          const token = parts[1].split("/")[0].split("?")[0];
          router.push(`/g/${token}`);
          return;
        }
      }
      
      // If it looks like a raw UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(text)) {
        router.push(`/join/${text}`);
        return;
      }

      setError("Invalid Spenit QR code");
    } catch (err) {
      setError("Failed to parse QR code");
    }
  };

  if (!authed) return null;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="px-5 py-4 flex items-center gap-4 bg-black/50 backdrop-blur-md sticky top-0 z-10 border-b border-white/10">
        <Link href="/dashboard" className="text-white/70 hover:text-white p-1 -ml-1 active:scale-95 transition-transform">
          <ChevronLeft size={24} />
        </Link>
        <div className="flex items-center gap-2">
          <QrCode size={18} className="text-white/80" />
          <h1 className="text-[17px] font-bold text-white tracking-tight">Scan to Join</h1>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6 relative">
        <div className="w-full max-w-sm aspect-square relative rounded-3xl overflow-hidden border-2 border-[var(--accent)] shadow-[0_0_40px_rgba(245,158,11,0.2)]">
          <Scanner 
            onScan={(result) => {
              if (result && result.length > 0) {
                handleScan(result[0].rawValue);
              }
            }}
            formats={["qr_code"]}
          />
        </div>

        <p className="mt-8 text-center text-[14px] font-medium text-white/70">
          Point your camera at a Spenit group invite QR code
        </p>
        
        {error && (
          <div className="mt-6 flex items-center gap-2 bg-red-500/10 text-red-400 px-4 py-2.5 rounded-[12px] text-[13px] font-bold">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
      </main>
    </div>
  );
}
