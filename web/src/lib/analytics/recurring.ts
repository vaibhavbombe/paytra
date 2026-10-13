// Recurring-payment detection: subscriptions, EMIs, rent, SIPs.
// Pure function over money-out history; amounts in BigInt paise, dates as
// IST "YYYY-MM-DD". No floats in money maths.

import { normaliseKey } from "@/lib/categorise/engine";

export type Payment = { payee: string; date: string; amountPaise: bigint; category: string | null };

export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";

export type Recurring = {
  payee: string; // as last seen
  category: string | null;
  cadence: Cadence;
  count: number;
  typicalPaise: bigint; // median amount
  fixedAmount: boolean; // every payment exactly the same
  lastDate: string;
  nextDate: string; // expected next payment
  active: boolean; // false if it looks like it stopped
  monthlyPaise: bigint; // monthly-equivalent cost, for sorting/totals
};

const CADENCES: { cadence: Cadence; min: number; max: number; minCount: number; days: number }[] = [
  { cadence: "weekly", min: 6, max: 8, minCount: 4, days: 7 },
  { cadence: "monthly", min: 27, max: 33, minCount: 3, days: 30 },
  { cadence: "quarterly", min: 85, max: 95, minCount: 3, days: 91 },
  { cadence: "yearly", min: 355, max: 375, minCount: 2, days: 365 },
];

const SHARE_REQUIRED = 0.75; // tolerate one missed/odd payment
const AMOUNT_TOLERANCE_PCT = 15n;
const DAY_MS = 86_400_000;

const toDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
const fromDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

function median<T>(sorted: T[]): T {
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Same day next month(s), clamped (31 Jan + 1 month = 28/29 Feb). */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function detectRecurring(payments: Payment[], today: string): Recurring[] {
  const groups = new Map<string, Payment[]>();
  for (const p of payments) {
    const key = normaliseKey(p.payee);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  const found: Recurring[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));

    // Same-day duplicates (split payments) count as one occurrence.
    const days = [...new Set(sorted.map((p) => toDay(p.date)))];
    const gaps = days.slice(1).map((d, i) => d - days[i]);
    if (gaps.length === 0) continue;
    const typicalGap = median([...gaps].sort((a, b) => a - b));

    const c = CADENCES.find((x) => typicalGap >= x.min && typicalGap <= x.max);
    if (!c || days.length < c.minCount) continue;
    if (gaps.filter((g) => g >= c.min && g <= c.max).length / gaps.length < SHARE_REQUIRED) continue;

    // Stable amount: most payments within ±15% of the median.
    const amounts = sorted.map((p) => p.amountPaise).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const typical = median(amounts);
    const stable = amounts.filter((a) => {
      const diff = a > typical ? a - typical : typical - a;
      return diff * 100n <= typical * AMOUNT_TOLERANCE_PCT;
    }).length;
    if (stable / amounts.length < SHARE_REQUIRED) continue;

    const last = sorted[sorted.length - 1];
    const nextDate =
      c.cadence === "monthly" ? addMonths(last.date, 1)
      : c.cadence === "quarterly" ? addMonths(last.date, 3)
      : c.cadence === "yearly" ? addMonths(last.date, 12)
      : fromDay(toDay(last.date) + 7);

    // Stopped if we're well past the expected date (1.5 cycles since last).
    const active = toDay(today) - toDay(last.date) <= Math.ceil(c.days * 1.5);

    found.push({
      payee: last.payee,
      category: last.category,
      cadence: c.cadence,
      count: sorted.length,
      typicalPaise: typical,
      fixedAmount: amounts[0] === amounts[amounts.length - 1],
      lastDate: last.date,
      nextDate,
      active,
      // amount x (365 / 12) / cycle days, in integer maths.
      monthlyPaise: (typical * 365n) / (12n * BigInt(c.days)),
    });
  }

  // Active first, then by monthly cost.
  return found.sort((a, b) => Number(b.active) - Number(a.active) || (b.monthlyPaise > a.monthlyPaise ? 1 : b.monthlyPaise < a.monthlyPaise ? -1 : 0));
}
