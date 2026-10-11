import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { isoDateIST } from "@/lib/dates";
import { getFormOptions, getRecentTransactions } from "@/lib/transactions/queries";

import { TransactionForm } from "./transaction-form";

export const metadata: Metadata = { title: "Transactions · PayTra" };

export default function TransactionsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <Link href="/dashboard" className="text-sm text-muted underline">
          Dashboard
        </Link>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Add a transaction</h2>
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <AddTransaction />
        </Suspense>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent</h2>
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <RecentList />
        </Suspense>
      </section>
    </main>
  );
}

async function AddTransaction() {
  const options = await getFormOptions();
  if (!options) redirect("/login");

  return <TransactionForm today={isoDateIST()} accounts={options.accounts} categories={options.categories} />;
}

async function RecentList() {
  const rows = await getRecentTransactions();
  if (!rows) redirect("/login");

  if (!rows.length) {
    return <p className="text-sm text-muted">No transactions yet. Add your first one above.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {rows.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-4 p-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{t.description}</p>
            <p className="text-xs text-muted">
              {t.date} · {t.category} · {t.account}
            </p>
          </div>
          <p className={`shrink-0 font-mono ${t.direction === "DEBIT" ? "text-debit" : "text-credit"}`}>
            {t.direction === "DEBIT" ? "−" : "+"}
            {t.amount}
          </p>
        </li>
      ))}
    </ul>
  );
}
