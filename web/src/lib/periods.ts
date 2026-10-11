// Reporting periods over IST calendar dates ("YYYY-MM-DD").
// All maths is on date-only values in UTC, so there's no time-of-day or DST
// drift: a "day" is a calendar day, never "24 hours".
//
// Ranges are half-open [start, end): end is the first day AFTER the period.
// That makes "txn_date >= start AND txn_date < end" exact, with no
// 23:59:59.999 edge cases.

export const PERIODS = ["day", "week", "month", "year"] as const;
export type Period = (typeof PERIODS)[number];

export type PeriodRange = {
  period: Period;
  start: string; // inclusive
  end: string; // exclusive
  label: string;
  prev: string; // an anchor date inside the previous period
  next: string; // an anchor date inside the next period
};

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

// Day 1 avoids month-end overflow (Jan 31 + 1 month must not become Mar 3).
function firstOfMonth(year: number, monthIndex: number): string {
  return toIso(new Date(Date.UTC(year, monthIndex, 1)));
}

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" });
const dayLabel = fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
const dayMonth = fmt({ day: "numeric", month: "short" });
const dayMonthYear = fmt({ day: "numeric", month: "short", year: "numeric" });
const monthLabel = fmt({ month: "long", year: "numeric" });

export function periodRange(period: Period, anchor: string): PeriodRange {
  const a = toDate(anchor);
  const y = a.getUTCFullYear();
  const m = a.getUTCMonth();

  switch (period) {
    case "day":
      return {
        period,
        start: anchor,
        end: addDays(anchor, 1),
        label: dayLabel.format(a),
        prev: addDays(anchor, -1),
        next: addDays(anchor, 1),
      };

    case "week": {
      // Indian business convention (and ISO 8601): weeks run Monday-Sunday.
      const sinceMonday = (a.getUTCDay() + 6) % 7;
      const start = addDays(anchor, -sinceMonday);
      const end = addDays(start, 7);
      const last = toDate(addDays(end, -1));
      const sameYear = toDate(start).getUTCFullYear() === last.getUTCFullYear();
      return {
        period,
        start,
        end,
        label: `${(sameYear ? dayMonth : dayMonthYear).format(toDate(start))} – ${dayMonthYear.format(last)}`,
        prev: addDays(start, -7),
        next: end,
      };
    }

    case "month":
      return {
        period,
        start: firstOfMonth(y, m),
        end: firstOfMonth(y, m + 1),
        label: monthLabel.format(a),
        prev: firstOfMonth(y, m - 1),
        next: firstOfMonth(y, m + 1),
      };

    case "year":
      return {
        period,
        start: firstOfMonth(y, 0),
        end: firstOfMonth(y + 1, 0),
        label: String(y),
        prev: firstOfMonth(y - 1, 0),
        next: firstOfMonth(y + 1, 0),
      };
  }
}
