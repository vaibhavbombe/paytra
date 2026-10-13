import "server-only";

import { isoDateIST } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { periodRange, type Period } from "@/lib/periods";

import { detectRecurring } from "./recurring";
import { CATEGORY_SPLIT_SQL, RECURRING_CANDIDATES_SQL, TOP_PAYEES_SQL, TOTALS_SQL, TREND_SQL, type Bucket } from "./sql";

export type AnalyticsPeriod = Exclude<Period, "day">;

const BUCKET: Record<AnalyticsPeriod, Bucket> = { week: "day", month: "day", year: "month" };
const RECURRING_LOOKBACK_DAYS = 400; // >1 year, so yearly payments are seen twice

const dayLabel = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });

/** Percentage change in integer maths (null when there's nothing to compare). */
function change(current: bigint, previous: bigint): number | null {
  if (previous <= 0n) return null;
  return Number(((current - previous) * 100n) / previous);
}

export async function getAnalytics(userId: string, period: AnalyticsPeriod, anchor: string) {
  const today = isoDateIST();
  const range = periodRange(period, anchor);
  const prev = periodRange(period, range.prev);
  const lookbackStart = new Date(Date.parse(`${today}T00:00:00Z`) - RECURRING_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const tomorrow = periodRange("day", today).end;

  type Totals = { spend: string; income: string; count: number };
  const [[cur], [before], trend, split, payees, candidates] = await Promise.all([
    db.$queryRawUnsafe<Totals[]>(TOTALS_SQL, userId, range.start, range.end),
    db.$queryRawUnsafe<Totals[]>(TOTALS_SQL, userId, prev.start, prev.end),
    db.$queryRawUnsafe<{ bucket: string; spend: string }[]>(TREND_SQL, userId, range.start, range.end, BUCKET[period]),
    db.$queryRawUnsafe<{ name: string; spend: string }[]>(CATEGORY_SPLIT_SQL, userId, range.start, range.end),
    db.$queryRawUnsafe<{ payee: string; count: number; total: string }[]>(TOP_PAYEES_SQL, userId, range.start, range.end, 8),
    db.$queryRawUnsafe<{ payee: string; date: string; amount: string; category: string | null }[]>(
      RECURRING_CANDIDATES_SQL,
      userId,
      lookbackStart,
      tomorrow,
    ),
  ]);

  const spend = BigInt(cur.spend);
  const income = BigInt(cur.income);
  const prevSpend = BigInt(before.spend);
  const prevIncome = BigInt(before.income);
  const splitTotal = split.reduce((s, r) => s + BigInt(r.spend), 0n);

  const recurring = detectRecurring(
    candidates.map((c) => ({ payee: c.payee, date: c.date, amountPaise: BigInt(c.amount), category: c.category })),
    today,
  );
  const recurringMonthly = recurring.filter((r) => r.active).reduce((s, r) => s + r.monthlyPaise, 0n);

  // Everything leaves this function formatted: BigInt never reaches the client.
  // Chart heights use rupees as plain numbers (drawing only); every label and
  // tooltip uses the exact formatted string.
  return {
    range,
    prevLabel: prev.label,
    isCurrent: range.start <= today && today < range.end,
    totals: {
      spend: formatPaise(spend),
      income: formatPaise(income),
      net: formatPaise(income - spend),
      netNegative: income < spend,
      count: cur.count,
      spendChange: change(spend, prevSpend),
      incomeChange: change(income, prevIncome),
      prevSpend: formatPaise(prevSpend),
      prevIncome: formatPaise(prevIncome),
    },
    trend: trend.map((t) => {
      const paise = BigInt(t.spend);
      const date = new Date(`${t.bucket}T00:00:00Z`);
      return {
        key: t.bucket,
        label: BUCKET[period] === "month" ? monthLabel.format(date) : dayLabel.format(date),
        value: Number(paise > 0n ? paise : 0n) / 100,
        text: formatPaise(paise),
      };
    }),
    categories: split.map((c) => {
      const paise = BigInt(c.spend);
      return {
        name: c.name,
        text: formatPaise(paise),
        share: splitTotal > 0n ? Number((paise * 1000n) / splitTotal) / 10 : 0, // one decimal, integer maths
      };
    }),
    payees: payees.map((p) => ({ payee: p.payee, count: p.count, total: formatPaise(BigInt(p.total)) })),
    recurring: recurring.map((r) => ({
      payee: r.payee,
      category: r.category,
      cadence: r.cadence,
      typical: formatPaise(r.typicalPaise),
      fixedAmount: r.fixedAmount,
      count: r.count,
      lastDate: r.lastDate,
      nextDate: r.nextDate,
      active: r.active,
      monthly: formatPaise(r.monthlyPaise),
    })),
    recurringMonthly: formatPaise(recurringMonthly),
  };
}

export type AnalyticsData = Awaited<ReturnType<typeof getAnalytics>>;
