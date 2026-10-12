import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

import { DeleteRuleButton } from "./delete-rule-button";

export const metadata: Metadata = { title: "Category rules · PayTra" };

export default function RulesPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Category rules</h1>
        <Link href="/transactions" className="text-sm text-muted underline">
          Transactions
        </Link>
      </div>
      <p className="text-sm text-muted">
        When you change a transaction&apos;s category, PayTra remembers it as a rule for that payee. Your rules always win
        over the built-in ones. Deleting a rule doesn&apos;t change transactions already categorised.
      </p>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <RuleList />
      </Suspense>
    </main>
  );
}

async function RuleList() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [mine, builtInCount] = await Promise.all([
    db.categoryRule.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        pattern: true,
        direction: true,
        category: { select: { name: true } },
        _count: { select: { transactions: true } },
      },
    }),
    db.categoryRule.count({ where: { userId: null } }),
  ]);

  return (
    <div className="space-y-4">
      {mine.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
          No rules of your own yet. Click a category in the{" "}
          <Link href="/transactions" className="underline">
            transaction list
          </Link>{" "}
          to change it, and it&apos;s remembered here.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {mine.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm">{r.pattern}</p>
                <p className="text-xs text-muted">
                  {r.direction === "DEBIT" ? "Money out" : r.direction === "CREDIT" ? "Money in" : "Either"} →{" "}
                  <span className="font-medium text-foreground">{r.category.name}</span> · used by {r._count.transactions}
                </p>
              </div>
              <DeleteRuleButton ruleId={r.id} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">Plus {builtInCount} built-in rules for common Indian merchants (Swiggy, BigBasket, Airtel, LIC, Zerodha…).</p>
    </div>
  );
}
