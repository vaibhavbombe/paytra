import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import { themeInitScript } from "@/lib/theme";

import "./globals.css";
import { LiveAlerts } from "./live-alerts";
import { Logo } from "./logo";
import { MainNav } from "./main-nav";
import { ThemeToggle } from "./theme-toggle";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PayTra",
  description: "All your payments in one place",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the init script adds the `dark` class before
    // React hydrates, which is intentional (only affects this element's attrs).
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2 font-semibold">
            <Logo className="size-6" />
            PayTra
          </Link>
          {/* Takes the middle; on narrow screens it wraps to its own row and scrolls sideways. */}
          <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
            <MainNav />
          </div>
          <div className="ml-auto shrink-0">
            <ThemeToggle />
          </div>
        </header>
        {children}
        <LiveAlerts />
      </body>
    </html>
  );
}
