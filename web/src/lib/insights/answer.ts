import { formatPaise } from "@/lib/money";

import type { CheckedPlan } from "./plan";

// The answer is written by PayTra from SQL results, not by the model: every
// number shown comes straight from Postgres, and no amount is sent to the AI.

export type Answer = {
  headline: string;
  // How the question was read, so the user can spot a misunderstanding.
  interpretation: string[];
  table: { columns: string[]; rows: string[][] } | null;
};

type Run = Exclude<CheckedPlan, { tool: "unsupported" }>;

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const month = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
const d = (iso: string) => day.format(new Date(`${iso}T00:00:00Z`));
const rupees = (paise: string) => formatPaise(BigInt(paise));
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function periodText(p: Run): string {
  return p.start === p.lastDay ? d(p.start) : `${d(p.start)} to ${d(p.lastDay)}`;
}

function interpretation(p: Run): string[] {
  const out = [`Period: ${periodText(p)}`];
  if (p.category) out.push(`Category: ${p.category}`);
  if (p.payee) out.push(`Payee contains: "${p.payee}"`);
  return out;
}

/** Integer percentage of a part (largest-remainder rounding isn't needed for display). */
function percent(part: bigint, whole: bigint): number {
  return whole > 0n ? Number((part * 100n) / whole) : 0;
}

export function totalAnswer(p: Run, r: { spend: string; income: string; count: number }): Answer {
  const what = p.payee && p.category ? `on ${p.category} at "${p.payee}"` : p.payee ? `at "${p.payee}"` : p.category ? `on ${p.category}` : "";
  let headline: string;
  if (r.count === 0) headline = `No transactions found ${what ? `${what} ` : ""}for ${periodText(p)}.`;
  else if (p.category || p.payee) headline = `You spent ${rupees(r.spend)} ${what} (${plural(r.count, "transaction")}).`;
  else headline = `You spent ${rupees(r.spend)} and received ${rupees(r.income)} (${plural(r.count, "transaction")}).`;
  return { headline, interpretation: interpretation(p), table: null };
}

export function byCategoryAnswer(p: Run, rows: { name: string; spend: string }[]): Answer {
  if (rows.length === 0) return { headline: `No spending found for ${periodText(p)}.`, interpretation: interpretation(p), table: null };
  const total = rows.reduce((s, r) => s + BigInt(r.spend), 0n);
  const [top] = rows;
  return {
    headline: `You spent ${formatPaise(total)} in total; the biggest category was ${top.name} at ${rupees(top.spend)} (${percent(BigInt(top.spend), total)}%).`,
    interpretation: interpretation(p),
    table: { columns: ["Category", "Spent", "Share"], rows: rows.map((r) => [r.name, rupees(r.spend), `${percent(BigInt(r.spend), total)}%`]) },
  };
}

export function trendAnswer(p: Run, rows: { bucket: string; spend: string }[]): Answer {
  const label = (b: string) => (p.granularity === "month" ? month.format(new Date(`${b}T00:00:00Z`)) : p.granularity === "week" ? `Week of ${d(b)}` : d(b));
  const nonZero = rows.filter((r) => BigInt(r.spend) !== 0n);
  if (nonZero.length === 0) return { headline: `No spending found for ${periodText(p)}.`, interpretation: interpretation(p), table: null };
  const peak = rows.reduce((a, b) => (BigInt(b.spend) > BigInt(a.spend) ? b : a));
  const total = rows.reduce((s, r) => s + BigInt(r.spend), 0n);
  return {
    headline: `You spent ${formatPaise(total)} over this period; the highest ${p.granularity} was ${label(peak.bucket)} at ${rupees(peak.spend)}.`,
    interpretation: [...interpretation(p), `Grouped by ${p.granularity}`],
    table: { columns: [p.granularity === "day" ? "Day" : p.granularity === "week" ? "Week" : "Month", "Spent"], rows: rows.map((r) => [label(r.bucket), rupees(r.spend)]) },
  };
}

export function topPayeesAnswer(p: Run, rows: { payee: string; count: number; total: string }[]): Answer {
  if (rows.length === 0) return { headline: `No payments found for ${periodText(p)}.`, interpretation: interpretation(p), table: null };
  const [top] = rows;
  return {
    headline: `You paid ${top.payee} the most: ${rupees(top.total)} across ${plural(top.count, "payment")}.`,
    interpretation: [...interpretation(p), `Top ${p.limit}`],
    table: { columns: ["Payee", "Payments", "Total"], rows: rows.map((r) => [r.payee, String(r.count), rupees(r.total)]) },
  };
}

export function transactionsAnswer(
  p: Run,
  rows: { date: string; payee: string; direction: string; amount: string; category: string; matched: number }[],
): Answer {
  if (rows.length === 0) return { headline: `No transactions found for ${periodText(p)}.`, interpretation: interpretation(p), table: null };
  const matched = rows[0].matched;
  return {
    headline: matched > rows.length ? `${matched} transactions match; showing the latest ${rows.length}.` : `${plural(matched, "transaction")} found.`,
    interpretation: interpretation(p),
    table: {
      columns: ["Date", "Payee", "Category", "Amount"],
      rows: rows.map((r) => [d(r.date), r.payee, r.category, `${r.direction === "CREDIT" ? "+" : "−"}${rupees(r.amount)}`]),
    },
  };
}
