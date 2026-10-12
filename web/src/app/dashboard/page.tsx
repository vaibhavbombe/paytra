import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSessionUser } from "@/lib/auth/session";

import { LogoutButton } from "./logout-button";

export const metadata: Metadata = { title: "Dashboard · PayTra" };

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      {/* Reading the session is request-time data, so it streams in behind
          a Suspense boundary (required with Cache Components). */}
      <Suspense fallback={<p className="mt-4 text-muted">Loading…</p>}>
        <SignedInAs />
      </Suspense>
      <nav className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/transactions"
          className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Transactions →
        </Link>
        <Link href="/imports" className="rounded-md border border-input px-4 py-2 font-medium hover:bg-surface-hover">
          Import statement
        </Link>
        <Link href="/accounts" className="rounded-md border border-input px-4 py-2 font-medium hover:bg-surface-hover">
          Accounts
        </Link>
      </nav>
    </main>
  );
}

async function SignedInAs() {
  // The real auth check. proxy.ts only does a quick "is there a cookie?" hint.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="mt-4 flex items-center justify-between rounded-md border border-border p-4">
      <p>
        Signed in as <span className="font-medium">{user.displayName ?? user.email}</span>
      </p>
      <LogoutButton />
    </div>
  );
}
