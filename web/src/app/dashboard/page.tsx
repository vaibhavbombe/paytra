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
      <Suspense fallback={<p className="mt-4 text-gray-500">Loading…</p>}>
        <SignedInAs />
      </Suspense>
      <Link
        href="/transactions"
        className="mt-6 inline-block rounded-md bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-700"
      >
        Transactions →
      </Link>
    </main>
  );
}

async function SignedInAs() {
  // The real auth check. proxy.ts only does a quick "is there a cookie?" hint.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="mt-4 flex items-center justify-between rounded-md border border-gray-200 p-4">
      <p>
        Signed in as <span className="font-medium">{user.displayName ?? user.email}</span>
      </p>
      <LogoutButton />
    </div>
  );
}
