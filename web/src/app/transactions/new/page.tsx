import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { isoDateIST } from "@/lib/dates";
import { getFormOptions } from "@/lib/transactions/queries";

import { TransactionForm } from "../transaction-form";

export const metadata: Metadata = { title: "Add transaction · PayTra" };

export default function NewTransactionPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Add a transaction</h1>
        <Link href="/transactions" className="text-sm text-muted underline">
          View transactions
        </Link>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <AddTransaction />
      </Suspense>
    </main>
  );
}

async function AddTransaction() {
  const options = await getFormOptions();
  if (!options) redirect("/login");

  return <TransactionForm today={isoDateIST()} accounts={options.accounts} categories={options.categories} />;
}
