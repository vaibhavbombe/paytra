import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { isoDateIST } from "@/lib/dates";
import { PERIODS } from "@/lib/periods";
import { listHref, parseListFilters, type ListFilters } from "@/lib/transactions/filters";
import { getFilterOptions, listTransactions } from "@/lib/transactions/queries";

export const metadata: Metadata = { title: "Transactions · PayTra" };

const PERIOD_LABEL = { day: "Day", week: "Week", month: "Month", year: "Year" } as const;

export default function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <Link
          href="/transactions/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          + Add transaction
        </Link>
      </div>
      {/* searchParams and the session are request-time data, so everything
          below streams in behind one boundary. */}
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <TransactionsView searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function TransactionsView({ searchParams }: { searchParams: PageProps<"/transactions">["searchParams"] }) {
  const params = await searchParams;
  await io(); // "today" depends on the clock: compute per request, never prerender
  const today = isoDateIST();
  const filters = parseListFilters(params);
  const [data, options] = await Promise.all([listTransactions(filters), getFilterOptions()]);
  if (!data || !options) redirect("/login");

  const { range, totals, rows, nextCursor } = data;
  // Navigation keeps the active filters but always restarts paging.
  const base: Partial<ListFilters> = { ...filters, cursor: null };

  // Group the page's rows under day headings.
  const days = new Map<string, typeof rows>();
  for (const r of rows) days.set(r.date, [...(days.get(r.date) ?? []), r]);

  return (
    <div className="space-y-6">
      {/* Period picker */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Period" className="inline-flex rounded-md border border-border p-0.5 text-sm">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={listHref({ ...base, period: p })}
              aria-current={filters.period === p ? "page" : undefined}
              className={`rounded px-3 py-1 font-medium ${
                filters.period === p ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-hover"
              }`}
            >
              {PERIOD_LABEL[p]}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href={listHref({ ...base, date: range.prev })}
            aria-label="Previous period"
            className="rounded-md border border-input px-2.5 py-1 hover:bg-surface-hover"
          >
            ◀
          </Link>
          <span className="min-w-40 text-center font-medium">{range.label}</span>
          {range.end <= today ? (
            <Link
              href={listHref({ ...base, date: range.next })}
              aria-label="Next period"
              className="rounded-md border border-input px-2.5 py-1 hover:bg-surface-hover"
            >
              ▶
            </Link>
          ) : (
            <span aria-hidden className="rounded-md border border-border px-2.5 py-1 text-muted opacity-40">
              ▶
            </span>
          )}
        </div>
      </div>

      {/* Totals for the whole filtered period */}
      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Money in" value={totals.moneyIn} className="text-credit" />
        <Stat label="Money out" value={totals.moneyOut} className="text-debit" />
        <Stat label="Net" value={totals.net} className={totals.netIsNegative ? "text-debit" : "text-credit"} />
      </dl>
      <p className="-mt-3 text-xs text-muted">
        {totals.count} transaction{totals.count === 1 ? "" : "s"} in this period
        {totals.transferCount > 0 &&
          ` · ${totals.transferCount} transfer${totals.transferCount === 1 ? "" : "s"} not counted in money in/out`}
      </p>

      {/* Filters: a plain GET form, works without JavaScript */}
      <form action="/transactions" className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
        <input type="hidden" name="period" value={filters.period} />
        <input type="hidden" name="date" value={filters.date} />
        <input
          name="q"
          defaultValue={filters.q ?? ""}
          maxLength={60}
          placeholder="Search description"
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
        <select name="dir" defaultValue={filters.direction ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          <option value="">In &amp; out</option>
          <option value="DEBIT">Money out</option>
          <option value="CREDIT">Money in</option>
        </select>
        <select name="cat" defaultValue={filters.categoryId ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          <option value="">All categories</option>
          <option value="none">Uncategorised</option>
          {options.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="acc" defaultValue={filters.accountId ?? ""} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          <option value="">All accounts</option>
          {options.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Apply
          </button>
          <Link
            href={listHref({ period: filters.period, date: filters.date })}
            className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            Clear
          </Link>
        </div>
      </form>

      {/* List */}
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
          No transactions match. Try another period or clear the filters.
        </p>
      ) : (
        <div className="space-y-4">
          {[...days].map(([date, items]) => (
            <section key={date}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{date}</h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {items.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-4 p-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.description}</p>
                      <p className="text-xs text-muted">
                        {t.category}
                        {t.isTransfer && " (transfer)"} · {t.account}
                      </p>
                    </div>
                    <p className={`shrink-0 font-mono ${t.direction === "DEBIT" ? "text-debit" : "text-credit"}`}>
                      {t.direction === "DEBIT" ? "−" : "+"}
                      {t.amount}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {(filters.cursor || nextCursor) && (
        <div className="flex justify-between text-sm">
          {filters.cursor ? (
            <Link href={listHref(base)} className="underline">
              ← First page
            </Link>
          ) : (
            <span />
          )}
          {nextCursor && (
            <Link href={listHref({ ...base, cursor: nextCursor })} className="underline">
              Older →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-1 truncate font-mono text-lg font-semibold ${className}`}>{value}</dd>
    </div>
  );
}
