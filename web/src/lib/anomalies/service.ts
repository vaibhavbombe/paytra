import "server-only";

import { isoDateIST } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { periodRange } from "@/lib/periods";

import { CATEGORY_SPIKES_SQL, LARGE, LARGE_PAYMENTS_SQL, SPIKE } from "./sql";

export type UnusualPayment = { id: string; date: string; payee: string; category: string; amount: string; typical: string; times: number };
export type CategorySpike = { name: string; current: string; typical: string; times: string };

/** "4.6x" style ratio from integer paise, one decimal, no floats in money maths. */
function ratio(part: bigint, whole: bigint): string {
  const tenths = (part * 10n) / whole;
  return `${tenths / 10n}.${tenths % 10n}`;
}

export async function getUnusualSpending(userId: string) {
  const today = isoDateIST();
  const tomorrow = periodRange("day", today).end;
  const monthStart = periodRange("month", today).start;
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - LARGE.lookbackDays * 86_400_000).toISOString().slice(0, 10);

  const [payments, spikes] = await Promise.all([
    db.$queryRawUnsafe<{ id: string; date: string; payee: string; category: string; amount: string; typical: string }[]>(
      LARGE_PAYMENTS_SQL,
      userId,
      from,
      tomorrow,
      LARGE.multiple,
      LARGE.minPaise,
      LARGE.minHistory,
      LARGE.historyDays,
    ),
    db.$queryRawUnsafe<{ name: string; current: string; typical: string }[]>(
      CATEGORY_SPIKES_SQL,
      userId,
      monthStart,
      tomorrow,
      SPIKE.months,
      SPIKE.numerator,
      SPIKE.denominator,
      SPIKE.minExtraPaise,
    ),
  ]);

  return {
    payments: payments.map(
      (p): UnusualPayment => ({
        id: p.id,
        date: p.date,
        payee: p.payee,
        category: p.category,
        amount: formatPaise(BigInt(p.amount)),
        typical: formatPaise(BigInt(p.typical)),
        times: Number((BigInt(p.amount) / BigInt(p.typical))),
      }),
    ),
    spikes: spikes.map(
      (s): CategorySpike => ({
        name: s.name,
        current: formatPaise(BigInt(s.current)),
        typical: formatPaise(BigInt(s.typical)),
        times: ratio(BigInt(s.current), BigInt(s.typical)),
      }),
    ),
  };
}
