import { z } from "zod";

import { isoDateIST } from "@/lib/dates";
import { PERIODS, type Period } from "@/lib/periods";

export type ListFilters = {
  period: Period;
  date: string; // anchor date inside the period
  direction: "DEBIT" | "CREDIT" | null;
  categoryId: string | null; // "none" = uncategorised
  accountId: string | null;
  q: string | null;
  cursor: string | null;
};

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(first, schema.optional().catch(undefined));

// URL query params are untrusted input. Anything invalid falls back to the
// default instead of erroring, so a hand-edited URL still renders a page.
const Params = z.object({
  period: opt(z.enum(PERIODS)),
  date: opt(z.iso.date()),
  dir: opt(z.enum(["DEBIT", "CREDIT"])),
  cat: opt(z.union([z.uuid(), z.literal("none")])),
  acc: opt(z.uuid()),
  q: opt(z.string().trim().min(1).max(60)),
  cursor: opt(z.uuid()),
});

export function parseListFilters(
  searchParams: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): ListFilters {
  const p = Params.parse(searchParams);
  const today = isoDateIST(now);
  return {
    period: p.period ?? "month",
    // No browsing into the future or before 2000.
    date: p.date && p.date <= today && p.date >= "2000-01-01" ? p.date : today,
    direction: p.dir ?? null,
    categoryId: p.cat ?? null,
    accountId: p.acc ?? null,
    q: p.q ?? null,
    cursor: p.cursor ?? null,
  };
}

/** Builds a /transactions URL from filters, dropping defaults/empties. */
export function listHref(f: Partial<ListFilters>): string {
  const params = new URLSearchParams();
  if (f.period) params.set("period", f.period);
  if (f.date) params.set("date", f.date);
  if (f.direction) params.set("dir", f.direction);
  if (f.categoryId) params.set("cat", f.categoryId);
  if (f.accountId) params.set("acc", f.accountId);
  if (f.q) params.set("q", f.q);
  if (f.cursor) params.set("cursor", f.cursor);
  const qs = params.toString();
  return qs ? `/transactions?${qs}` : "/transactions";
}
