import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

import { AccountForm } from "./account-form";

export const metadata: Metadata = { title: "Accounts · PayTra" };

const TYPE_LABEL = { SAVINGS: "Savings", CURRENT: "Current", CREDIT_CARD: "Credit card", WALLET: "Wallet", CASH: "Cash" } as const;

export default function AccountsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <Link href="/imports" className="text-sm text-muted underline">
          Import a statement →
        </Link>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <AccountList />
      </Suspense>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Add a bank account or card</h2>
        <AccountForm />
      </section>
    </main>
  );
}

async function AccountList() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const accounts = await db.account.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      institutionName: true,
      nickname: true,
      type: true,
      last4: true,
      _count: { select: { transactions: true } },
    },
  });

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {accounts.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-4 p-3">
          <div>
            <p className="font-medium">
              {a.nickname ?? a.institutionName}
              {a.last4 && <span className="ml-2 font-mono text-muted">••{a.last4}</span>}
            </p>
            <p className="text-xs text-muted">
              {TYPE_LABEL[a.type]}
              {a.nickname && ` · ${a.institutionName}`}
            </p>
          </div>
          <p className="text-sm text-muted">
            {a._count.transactions} transaction{a._count.transactions === 1 ? "" : "s"}
          </p>
        </li>
      ))}
    </ul>
  );
}
