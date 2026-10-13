import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSessionUser } from "@/lib/auth/session";
import { recentActivity } from "@/lib/privacy/service";

import { DeleteAccount } from "./delete-account";

export const metadata: Metadata = { title: "Privacy & security · PayTra" };

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 p-6">
      <h1 className="text-2xl font-semibold">Privacy &amp; security</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <SettingsView />
      </Suspense>
    </main>
  );
}

async function SettingsView() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const activity = await recentActivity(user.id);

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">What PayTra stores</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Your transactions, accounts (last 4 digits only), categories, rules, budgets and alerts.</li>
          <li>Statement files are deleted as soon as they&apos;re read; only a fingerprint of the file is kept.</li>
          <li>Never your bank password, net banking login or UPI PIN.</li>
          <li>An activity log of sign-ins and changes, so you can spot anything you didn&apos;t do.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent activity</h2>
        <p className="text-sm text-muted">The last 50 events on your account. IP addresses are shortened.</p>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="p-2">When (IST)</th>
                <th className="p-2">What</th>
                <th className="p-2">Device</th>
                <th className="p-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap p-2 text-xs">{when.format(a.at)}</td>
                  <td className="p-2">
                    {a.action}
                    {a.detail && <span className="text-xs text-muted"> · {a.detail}</span>}
                  </td>
                  <td className="whitespace-nowrap p-2 text-xs">{a.device}</td>
                  <td className="whitespace-nowrap p-2 font-mono text-xs">{a.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Download your data</h2>
        <p className="text-sm text-muted">A JSON file with everything PayTra holds about you.</p>
        <a
          href="/api/export"
          download
          className="inline-block rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-surface-hover"
        >
          Download my data
        </a>
      </section>

      <section className="space-y-3 rounded-md border border-danger p-4">
        <h2 className="text-lg font-medium text-danger">Delete account</h2>
        <DeleteAccount />
      </section>
    </>
  );
}
