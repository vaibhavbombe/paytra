// Calendar dates for transactions are Indian dates (IST), stored as DATE.
// Never derive "today" from new Date().toISOString(): that's the UTC date,
// which is still "yesterday" in India until 05:30 IST.

export const APP_TIME_ZONE = "Asia/Kolkata";

const isoDateInIST = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" for the given instant, in IST. */
export function isoDateIST(at: Date = new Date()): string {
  return isoDateInIST.format(at); // en-CA formats as YYYY-MM-DD
}

/** "2026-10-11" -> Date at 00:00 UTC, the form Prisma expects for a DATE column. */
export function dateOnlyToDb(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** DATE column value -> "YYYY-MM-DD" (read back in UTC, where it was stored). */
export function dbDateToIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}
