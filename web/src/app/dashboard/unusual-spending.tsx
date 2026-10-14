import Link from "next/link";

import type { CategorySpike, UnusualPayment } from "@/lib/anomalies/service";

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Shown only when something stands out; quiet otherwise. */
export function UnusualSpending({ payments, spikes }: { payments: UnusualPayment[]; spikes: CategorySpike[] }) {
  if (payments.length === 0 && spikes.length === 0) return null;
  return (
    <section className="space-y-3 rounded-md border border-warning p-4" aria-labelledby="unusual-heading">
      <h2 id="unusual-heading" className="text-lg font-medium">
        Unusual spending
      </h2>
      <ul className="space-y-2 text-sm">
        {spikes.map((s) => (
          <li key={s.name}>
            <span className="font-medium">{s.name}</span>: {s.current} so far this month, {s.times}× a typical month ({s.typical}).
          </li>
        ))}
        {payments.map((p) => (
          <li key={p.id}>
            <span className="font-medium">{p.payee}</span>, {day.format(new Date(`${p.date}T00:00:00Z`))}: {p.amount} is {p.times}× your typical{" "}
            {p.category} payment ({p.typical}).
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        Compared with your own history: the median payment in that category over the previous 90 days, or the median
        of your last 3 months. Calculated by PayTra, not AI.{" "}
        <Link href="/transactions" className="underline">
          Review transactions
        </Link>
      </p>
    </section>
  );
}
