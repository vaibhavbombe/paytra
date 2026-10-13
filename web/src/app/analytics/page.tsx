import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getAnalytics, type AnalyticsPeriod } from "@/lib/analytics/service";
import { getSessionUser } from "@/lib/auth/session";
import { isoDateIST } from "@/lib/dates";

import { TrendChart } from "./trend-chart";

export const metadata: Metadata = { title: "Analytics · PayTra" };

const PERIODS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];
const CADENCE_LABEL = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" } as const;

const href = (period: AnalyticsPeriod, date?: string) => `/analytics?period=${period}${date ? `&date=${date}` : ""}`;

export default function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Analytics</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <AnalyticsView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function AnalyticsView({ searchParams }: { searchParams: PageProps<"/analytics">["searchParams"] }) {
  const params = await searchParams;
  await io(); // "today" depends on the clock: compute per request
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const today = isoDateIST();
  const period = (PERIODS.some((p) => p.value === params.period) ? params.period : "month") as AnalyticsPeriod;
  const rawDate = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;
  const anchor = rawDate > today || rawDate < "2000-01-01" ? today : rawDate;

  const a = await getAnalytics(user.id, period, anchor);
  const t = a.totals;

  return (
    <div className="space-y-8">
      {/* Period picker */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Period" className="inline-flex rounded-md border border-border p-0.5 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p.value}
              href={href(p.value, anchor)}
              aria-current={period === p.value ? "page" : undefined}
              className={`rounded px-3 py-1 font-medium ${period === p.value ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-hover"}`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href={href(period, a.range.prev)} aria-label="Previous period" className="rounded-md border border-input px-2.5 py-1 hover:bg-surface-hover">
            ◀
          </Link>
          <span className="min-w-40 text-center font-medium">{a.range.label}</span>
          {a.range.end <= today ? (
            <Link href={href(period, a.range.next)} aria-label="Next period" className="rounded-md border border-input px-2.5 py-1 hover:bg-surface-hover">
              ▶
            </Link>
          ) : (
            <span aria-hidden className="rounded-md border border-border px-2.5 py-1 text-muted opacity-40">
              ▶
            </span>
          )}
        </div>
      </div>

      {/* Headline numbers: this period vs the previous one */}
      <dl className="grid gap-3 sm:grid-cols-3">
        <Tile label="Spent" value={t.spend} change={t.spendChange} prev={`${t.prevSpend} in ${a.prevLabel}`} upIsBad />
        <Tile label="Income" value={t.income} change={t.incomeChange} prev={`${t.prevIncome} in ${a.prevLabel}`} />
        <Tile label="Net" value={t.net} valueClass={t.netNegative ? "text-debit" : "text-credit"} prev={`${t.count} transactions`} />
      </dl>
      {a.isCurrent && <p className="-mt-5 text-xs text-muted">This period isn&apos;t over yet, so the comparison will change.</p>}

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Spending {period === "year" ? "by month" : "by day"}</h2>
        <TrendChart points={a.trend} title={`Spending by ${period === "year" ? "month" : "day"}, ${a.range.label}`} />
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Where it went</h2>
          {a.categories.length === 0 ? (
            <p className="text-sm text-muted">No spending in this period.</p>
          ) : (
            <ul className="space-y-2.5">
              {a.categories.map((c) => (
                <li key={c.name} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span>{c.name}</span>
                    <span className="font-mono">
                      {c.text} <span className="text-muted">· {c.share}%</span>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                    <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.max(c.share, 1)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">Refunds are deducted from their category. Transfers and investments aren&apos;t spending.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Top payees</h2>
          {a.payees.length === 0 ? (
            <p className="text-sm text-muted">No payments in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-1">Payee</th>
                  <th className="pb-1 text-right">Payments</th>
                  <th className="pb-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {a.payees.map((p) => (
                  <tr key={p.payee} className="border-t border-border">
                    <td className="max-w-48 truncate py-1.5">{p.payee}</td>
                    <td className="py-1.5 text-right font-mono">{p.count}</td>
                    <td className="py-1.5 text-right font-mono">{p.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium">Recurring payments</h2>
          {a.recurring.length > 0 && (
            <p className="text-sm text-muted">
              About <span className="font-mono text-foreground">{a.recurringMonthly}</span> a month in active ones
            </p>
          )}
        </div>
        {a.recurring.length === 0 ? (
          <p className="text-sm text-muted">
            None detected yet. Subscriptions, EMIs and rent show up here once they&apos;ve repeated a few times (looking back 13 months).
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="p-2">Payee</th>
                  <th className="p-2">How often</th>
                  <th className="p-2 text-right">Amount</th>
                  <th className="p-2">Last</th>
                  <th className="p-2">Next expected</th>
                </tr>
              </thead>
              <tbody>
                {a.recurring.map((r) => (
                  <tr key={r.payee} className={`border-b border-border last:border-0 ${r.active ? "" : "text-muted"}`}>
                    <td className="p-2">
                      <span className="font-medium">{r.payee}</span>
                      {r.category && <span className="block text-xs text-muted">{r.category}</span>}
                    </td>
                    <td className="p-2">
                      {CADENCE_LABEL[r.cadence]} <span className="text-xs text-muted">×{r.count}</span>
                    </td>
                    <td className="p-2 text-right font-mono">
                      {r.fixedAmount ? "" : "~"}
                      {r.typical}
                    </td>
                    <td className="p-2 font-mono text-xs">{r.lastDate}</td>
                    <td className="p-2 text-xs">{r.active ? <span className="font-mono">{r.nextDate}</span> : "Looks stopped"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  change,
  prev,
  upIsBad = false,
  valueClass = "",
}: {
  label: string;
  value: string;
  change?: number | null;
  prev: string;
  upIsBad?: boolean;
  valueClass?: string;
}) {
  // More spending is bad, more income is good; the arrow + sign carry meaning, not colour alone.
  const good = change == null || change === 0 ? null : upIsBad ? change < 0 : change > 0;
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-xl font-semibold ${valueClass}`}>{value}</dd>
      <dd className="mt-1 text-xs text-muted">
        {change != null && (
          <span className={good === null ? "" : good ? "text-success" : "text-danger"}>
            {change > 0 ? "▲" : change < 0 ? "▼" : "•"} {change > 0 ? "+" : ""}
            {change}%{" "}
          </span>
        )}
        {change != null ? "vs " : ""}
        {prev}
      </dd>
    </div>
  );
}
