import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { accountsForAlert, reconciliationReport } from "@/lib/alerts/service";
import { getSessionUser } from "@/lib/auth/session";
import { isoDateIST } from "@/lib/dates";

import { ConfirmMatchButton } from "./confirm-button";
import { PasteAlert } from "./paste-alert";

export const metadata: Metadata = { title: "Reconciliation · PayTra" };

type Row = { id: string; txnDate: string; label: string; amount: string; direction: "DEBIT" | "CREDIT"; reference: string | null; matchedBy?: string | null };

export default function ReconciliationPage({ searchParams }: PageProps<"/reconciliation">) {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Reconciliation</h1>
        <p className="mt-1 text-sm text-muted">
          The same payment can reach PayTra twice: from a bank alert and from your statement. Payments with the same
          UPI/NEFT reference are merged automatically; close matches without a reference wait for your confirmation.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ReconciliationView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ReconciliationView({ searchParams }: { searchParams: PageProps<"/reconciliation">["searchParams"] }) {
  const params = await searchParams;
  await io();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { all: accounts } = await accountsForAlert(user.id, null);
  const today = isoDateIST();
  const accountId = typeof params.account === "string" && accounts.some((a) => a.id === params.account) ? params.account : accounts[0]?.id;
  const anchor = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month) ? `${params.month}-01` : today;
  const report = accountId ? await reconciliationReport(user.id, accountId, anchor > today ? today : anchor) : null;
  const href = (month: string) => `/reconciliation?account=${accountId}&month=${month.slice(0, 7)}`;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Add a bank alert</h2>
        <PasteAlert accounts={accounts} />
        <p className="text-xs text-muted">Automatic import from Gmail (read-only, with your permission) is coming next; pasting works the same way.</p>
      </section>

      {report && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <form action="/reconciliation" className="flex items-center gap-2">
              <input type="hidden" name="month" value={report.range.start.slice(0, 7)} />
              <select name="account" defaultValue={accountId} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-surface-hover">
                Show
              </button>
            </form>
            <div className="flex items-center gap-2">
              <Link href={href(report.range.prev)} aria-label="Previous month" className="rounded-md border border-input px-2.5 py-1 hover:bg-surface-hover">
                ◀
              </Link>
              <span className="min-w-36 text-center font-medium">{report.range.label}</span>
              {report.range.end <= today ? (
                <Link href={href(report.range.next)} aria-label="Next month" className="rounded-md border border-input px-2.5 py-1 hover:bg-surface-hover">
                  ▶
                </Link>
              ) : (
                <span aria-hidden className="rounded-md border border-border px-2.5 py-1 text-muted opacity-40">
                  ▶
                </span>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Matched" value={report.totals.matched} />
            <Stat label="Need your check" value={report.totals.suggestions + report.ambiguous.length} warn />
            <Stat label="Only in alerts" value={report.totals.onlyAlert} warn={report.totals.onlyAlert > 0} />
            <Stat label="Only in statement" value={report.totals.onlyBook} />
          </dl>

          {(report.suggestions.length > 0 || report.ambiguous.length > 0) && (
            <Block title="Suggested matches: please confirm">
              {report.suggestions.map((s) => (
                <li key={s.alert.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="space-y-0.5 text-sm">
                    <Line r={s.alert} tag="Alert" />
                    <Line r={s.book} tag="Statement" />
                    <p className="text-xs text-muted">Same amount and account, {s.dayDiff === 0 ? "same day" : `${s.dayDiff} day${s.dayDiff === 1 ? "" : "s"} apart`}, no shared reference.</p>
                  </div>
                  <ConfirmMatchButton alertId={s.alert.id} bookId={s.book.id} />
                </li>
              ))}
              {report.ambiguous.map((a) => (
                <li key={a.alert.id} className="space-y-1 p-3 text-sm">
                  <Line r={a.alert} tag="Alert" />
                  <p className="text-xs text-warning">Could be any of these {a.candidates.length} statement entries, so not merged automatically:</p>
                  {a.candidates.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 pl-4">
                      <Line r={c} tag="Statement" />
                      <ConfirmMatchButton alertId={a.alert.id} bookId={c.id} />
                    </div>
                  ))}
                </li>
              ))}
            </Block>
          )}

          <Block title={`Only in alerts (${report.onlyAlert.length})`} note={report.onlyAlert.length ? `Net ${report.totals.onlyAlertNet}. Usually fine until you import this month's statement; still here after that? Worth a look.` : undefined}>
            {report.onlyAlert.map((r) => (
              <li key={r.id} className="p-3 text-sm">
                <Line r={r} />
              </li>
            ))}
          </Block>

          <Block title={`Matched (${report.matched.length})`}>
            {report.matched.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <Line r={r} />
                <span className="shrink-0 text-xs text-muted">{r.matchedBy === "CONFIRMED" ? "confirmed by you" : "same reference"}</span>
              </li>
            ))}
          </Block>

          <Block title={`Only in statement (${report.onlyBook.length})`} note="Normal: banks don't send an alert for every entry (charges, interest, auto-debits).">
            {report.onlyBook.map((r) => (
              <li key={r.id} className="p-3 text-sm">
                <Line r={r} />
              </li>
            ))}
          </Block>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-xl font-semibold ${warn && value > 0 ? "text-warning" : ""}`}>{value}</dd>
    </div>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  const empty = Array.isArray(children) ? children.flat().length === 0 : !children;
  return (
    <details className="rounded-md border border-border" open={!empty}>
      <summary className="cursor-pointer p-3 font-medium">{title}</summary>
      {note && <p className="px-3 pb-2 text-xs text-muted">{note}</p>}
      {empty ? <p className="px-3 pb-3 text-sm text-muted">Nothing here.</p> : <ul className="divide-y divide-border border-t border-border">{children}</ul>}
    </details>
  );
}

function Line({ r, tag }: { r: Row; tag?: string }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      {tag && <span className="w-16 shrink-0 text-xs text-muted">{tag}</span>}
      <span className="font-mono text-xs">{r.txnDate}</span>
      <span className="truncate">{r.label}</span>
      <span className={`font-mono ${r.direction === "DEBIT" ? "text-debit" : "text-credit"}`}>
        {r.direction === "DEBIT" ? "−" : "+"}
        {r.amount}
      </span>
      {r.reference && <span className="font-mono text-xs text-muted">ref {r.reference}</span>}
    </span>
  );
}
