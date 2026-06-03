import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://scanmap.customy.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Scanmap by Customy",
    template: "%s · Scanmap",
  },
  description:
    "Find local businesses with weak websites. Real audits scoring SEO, performance, mobile, and tech stack. Built by Customy, a Bali-based marketing and AI studio.",
  keywords: [
    "lead generation", "website audit", "SEO audit", "local business leads",
    "marketing agency tools", "Bali marketing", "Customy",
  ],
  authors: [{ name: "Customy", url: "https://customy.io" }],
  creator: "Customy",
  applicationName: "Scanmap",
  category: "business",
  icons: {
    icon: [
      { url: "/customy_logo.png", type: "image/png" },
    ],
    shortcut: "/customy_logo.png",
    apple: "/customy_logo.png",
  },
  openGraph: {
    type: "website",
    title: "Scanmap by Customy",
    description: "Find local businesses with weak websites. Real audits, ready for outreach.",
    url: siteUrl,
    siteName: "Scanmap",
    images: [{ url: "/customy_logo.png", width: 512, height: 512, alt: "Customy" }],
  },
  twitter: {
    card: "summary",
    title: "Scanmap by Customy",
    description: "Find local businesses with weak websites. Real audits, ready for outreach.",
    images: ["/customy_logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export const viewport: Viewport = {
  themeColor: "#F3F5F3",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className={`${geist.className} antialiased`}>{children}</body>
    </html>
  );
}
