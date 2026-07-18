import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "pux.sh — know why your build failed before you open GitHub",
  description:
    "pux watches your CI pipeline. when your build fails, it collects the logs, extracts the error, and hands your AI agent the full context automatically.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://pux-site.vercel.app"
  ),
  openGraph: {
    title: "pux.sh",
    description:
      "know why your build failed before you open GitHub. AI-ready CI failure context, zero copy-paste.",
    url: "https://pux.sh",
    siteName: "pux.sh",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "pux.sh",
    description:
      "know why your build failed before you open GitHub. AI-ready CI failure context, zero copy-paste.",
  },
  keywords: [
    "CI",
    "GitHub Actions",
    "AI",
    "developer tools",
    "debugging",
    "build failures",
    "CLI",
  ],
  authors: [{ name: "Musharaf Parwej", url: "https://musharraf.codes" }],
  creator: "Musharaf Parwej",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-mono">{children}</body>
    </html>
  );
}
