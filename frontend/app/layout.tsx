import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Spenit — Split expenses effortlessly",
  description:
    "Spenit helps friend groups split expenses, settle debts with UPI, and track who owes what — with zero friend-request flows. Just share a link.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Spenit",
  },
  openGraph: {
    title: "Spenit — Split expenses effortlessly",
    description: "Share a link. Split expenses. Settle with UPI.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a12",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="min-h-full bg-[#0a0a12] text-white">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
