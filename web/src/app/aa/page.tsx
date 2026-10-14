import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { listAaConsents } from "@/lib/aa/service";
import { getSessionUser } from "@/lib/auth/session";
import { dbDateToIso, isoDateIST } from "@/lib/dates";

import { ConsentForm } from "./consent-form";
import { RevokeButton } from "./revoke-button";

export const metadata: Metadata = { title: "Link bank (Account Aggregator) · PayTra" };

const STATUS_LABEL = { PENDING: "Waiting for approval", ACTIVE: "Active", REVOKED: "Revoked", EXPIRED: "Expired", REJECTED: "Declined" } as const;

export default function AaPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Link your bank (Account Aggregator)</h1>
        <p className="mt-1 text-sm text-muted">
          Account Aggregators are RBI-licensed and share your bank data only with your explicit, time-limited consent. It
          replaces downloading and uploading statements.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <AaView />
      </Suspense>
    </main>
  );
}

async function AaView() {
  await io();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const consents = await listAaConsents(user.id);
  const today = isoDateIST();
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCMonth(from.getUTCMonth() - 12);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

  return (
    <>
      <ConsentForm from={from.toISOString().slice(0, 10)} to={today} />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Your consents</h2>
        {consents.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="space-y-3">
            {consents.map((c) => (
              <li key={c.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {STATUS_LABEL[c.status]}
                    <span className="ml-2 text-xs font-normal text-muted">requested {when.format(c.createdAt)}</span>
                  </p>
                  {c.status === "PENDING" && (
                    <Link href={`/aa/return?consent=${c.id}`} className="text-sm underline">
                      Check status
                    </Link>
                  )}
                </div>
                <p className="text-xs text-muted">
                  Bank transactions + balance · {c.dataFrom ? dbDateToIso(c.dataFrom) : "?"} to {c.dataTo ? dbDateToIso(c.dataTo) : "?"} · purpose 102 · one-time
                  {c.expiresAt && c.status !== "REVOKED" ? ` · valid until ${when.format(c.expiresAt)}` : ""}
                  {c.revokedAt ? ` · revoked ${when.format(c.revokedAt)}` : ""}
                </p>
                {c.details.summary && (
                  <p className="text-sm">
                    Imported {c.details.summary.inserted} new transaction{c.details.summary.inserted === 1 ? "" : "s"} from {c.details.summary.accounts} account
                    {c.details.summary.accounts === 1 ? "" : "s"}; {c.details.summary.duplicates} already known.
                  </p>
                )}
                {(c.status === "ACTIVE" || c.status === "PENDING" || (c.details.importBatchIds?.length ?? 0) > 0) && c.status !== "REVOKED" && (
                  <RevokeButton consentId={c.id} canDelete={(c.details.importBatchIds?.length ?? 0) > 0} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-muted">
        PayTra uses Setu&apos;s Account Aggregator <strong>sandbox</strong> with mock data. A live service would need RBI
        FIU registration through Sahamati and business KYC.
      </p>
    </>
  );
}
