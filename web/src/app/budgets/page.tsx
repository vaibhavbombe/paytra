import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSessionUser } from "@/lib/auth/session";
import { getBudgetStatuses } from "@/lib/budgets/service";
import { db } from "@/lib/db";

import { BudgetCard } from "./budget-card";
import { BudgetForm } from "./budget-form";

export const metadata: Metadata = { title: "Budgets · PayTra" };

export default function BudgetsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Budgets</h1>
        <Link href="/transactions" className="text-sm text-muted underline">
          Transactions
        </Link>
      </div>
      <p className="text-sm text-muted">
        Spent = money out minus refunds in the budget&apos;s categories. Transfers between your own accounts and
        investments don&apos;t count.
      </p>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <BudgetsView />
      </Suspense>
    </main>
  );
}

async function BudgetsView() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [budgets, categories] = await Promise.all([
    getBudgetStatuses(user.id),
    db.category.findMany({
      where: { kind: "EXPENSE", OR: [{ userId: null }, { userId: user.id }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-8">
      {budgets.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
          No budgets yet. Start with an overall monthly budget, then add categories like Food &amp; Dining.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {budgets.map((b) => (
            <BudgetCard key={b.id} b={b} />
          ))}
        </ul>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Add a budget</h2>
        <BudgetForm categories={categories} />
      </section>
    </div>
  );
}
