import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import { PageTransition } from "@/components/ui/PageTransition";
import { SW_URL } from "@/lib/sw";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Spenit — Split expenses effortlessly",
  description:
    "Spenit helps friend groups split expenses, settle debts with UPI, and track who owes what — with zero friend-request flows. Just share a link.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Spenit",
  },
  openGraph: {
    title: "Spenit — Split expenses effortlessly",
    description: "Share a link. Split expenses. Settle with UPI.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F9FAFB" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1014" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('spenit-theme')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`,
          }}
        />
        <link rel="apple-touch-icon" href="/apple-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-full">
        <Providers>
          <div className="app-frame">
            <PageTransition>
              {children}
            </PageTransition>
          </div>
        </Providers>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // iPhone Safari ignores user-scalable=no: stop pinch zoom by hand.
              // A long press (outside typing fields) opens no copy/share menu.
              (function(){
                function stop(e){ e.preventDefault(); }
                document.addEventListener('gesturestart', stop, { passive: false });
                document.addEventListener('gesturechange', stop, { passive: false });
                document.addEventListener('touchmove', function(e){ if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
                if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
                  document.addEventListener('contextmenu', function(e){
                    var t = e.target;
                    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], .selectable')) return;
                    e.preventDefault();
                  });
                }
              })();
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('${SW_URL}', { scope: '/' });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
