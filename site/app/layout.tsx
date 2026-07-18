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
    "Pux watches your CI pipeline. When your build fails, it collects the logs, extracts the error, and hands you AI-ready context.",
  openGraph: {
    title: "pux.sh",
    description: "pux tells you why your build failed before you open GitHub.",
    url: "https://pux.sh",
  },
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
