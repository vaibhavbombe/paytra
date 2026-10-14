import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getUnusualSpending } from "@/lib/anomalies/service";
import { getSessionUser } from "@/lib/auth/session";
import { getBudgetStatuses, recentAlerts } from "@/lib/budgets/service";

import { BudgetCard } from "../budgets/budget-card";

import { PushToggle } from "../settings/push-toggle";

import { AlertsPanel } from "./alerts-panel";
import { LogoutButton } from "./logout-button";
import { UnusualSpending } from "./unusual-spending";

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
        <Link href="/budgets" className="rounded-md border border-input px-4 py-2 font-medium hover:bg-surface-hover">
          Budgets
        </Link>
        <Link href="/accounts" className="rounded-md border border-input px-4 py-2 font-medium hover:bg-surface-hover">
          Accounts
        </Link>
      </nav>
      <Suspense fallback={null}>
        <BudgetsSummary />
      </Suspense>
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

async function BudgetsSummary() {
  const user = await getSessionUser();
  if (!user) return null;
  const [alerts, budgets, unusual] = await Promise.all([recentAlerts(user.id, 5), getBudgetStatuses(user.id), getUnusualSpending(user.id)]);

  return (
    <div className="mt-8 space-y-4">
      <AlertsPanel alerts={alerts} />
      <UnusualSpending payments={unusual.payments} spikes={unusual.spikes} />
      <PushToggle />
      {budgets.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Budgets</h2>
            <Link href="/budgets" className="text-sm text-muted underline">
              Manage
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {budgets.map((b) => (
              <BudgetCard key={b.id} b={b} showDelete={false} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted">
          <Link href="/budgets" className="underline">
            Set a budget
          </Link>{" "}
          to get alerts at 80% and 100%.
        </p>
      )}
    </div>
  );
}
