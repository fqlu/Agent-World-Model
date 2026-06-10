import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Incubeta Hub",
  description: "Drive Context Protocol — provision, audit, and repair agent-ready workspaces",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-baseline gap-3 px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight text-zinc-900">
              <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-indigo-600 align-baseline" />
              Incubeta Hub
            </Link>
            <span className="text-sm text-zinc-500">Drive Context Protocol</span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
