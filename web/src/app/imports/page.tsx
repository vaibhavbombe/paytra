import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { recentImports } from "@/lib/imports/service";

import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import statement · PayTra" };

export default function ImportsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Import a bank statement</h1>
        <Link href="/accounts" className="text-sm text-muted underline">
          Accounts
        </Link>
      </div>
      <p className="text-sm text-muted">
        Download your statement as <strong>CSV</strong> from net banking and upload it here. UPI payments made with GPay,
        PhonePe or Paytm appear in your bank statement, so they&apos;re captured this way. PayTra never asks for your
        bank password or UPI PIN.
      </p>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ImportSection />
      </Suspense>
    </main>
  );
}

async function ImportSection() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [accounts, history] = await Promise.all([
    db.account.findMany({
      where: { userId: user.id, type: { not: "CASH" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, nickname: true, institutionName: true, last4: true },
    }),
    recentImports(user.id),
  ]);

  return (
    <div className="space-y-8">
      <ImportForm
        accounts={accounts.map((a) => ({
          id: a.id,
          label: [a.nickname ?? a.institutionName, a.last4 ? `••${a.last4}` : null].filter(Boolean).join(" "),
        }))}
      />

      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Recent imports</h2>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="p-2">Imported</th>
                  <th className="p-2">File</th>
                  <th className="p-2">Account</th>
                  <th className="p-2">Period</th>
                  <th className="p-2 text-right">New</th>
                  <th className="p-2 text-right">Skipped</th>
                  <th className="p-2 text-right">Errors</th>
                  <th className="p-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="p-2 font-mono">{b.importedOn}</td>
                    <td className="max-w-40 truncate p-2">{b.fileName}</td>
                    <td className="p-2">{b.account}</td>
                    <td className="p-2 font-mono text-xs">{b.period}</td>
                    <td className="p-2 text-right font-mono">{b.inserted}</td>
                    <td className="p-2 text-right font-mono">{b.duplicates}</td>
                    <td className={`p-2 text-right font-mono ${b.errors ? "text-danger" : ""}`}>{b.errors}</td>
                    <td className={`p-2 text-xs ${b.balanceCheck === "mismatch" ? "text-danger" : b.balanceCheck === "ok" ? "text-success" : "text-muted"}`}>
                      {b.balanceCheck === "ok" ? "✓ ok" : b.balanceCheck === "mismatch" ? "⚠ mismatch" : "n/a"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
