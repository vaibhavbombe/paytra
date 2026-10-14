import { z } from "zod";

// The query plan from the AI service. Checked again here: the web app owns the
// data, so it validates everything that comes back, like any other input.

const isoDate = z.iso.date();

export const InsightPlan = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("unsupported"), reason: z.string().max(200).nullish() }),
  z.object({
    tool: z.enum(["total", "by_category", "trend", "top_payees", "transactions"]),
    from_date: isoDate,
    to_date: isoDate,
    category: z.string().max(80).nullish(),
    payee: z.string().trim().min(1).max(80).nullish(),
    granularity: z.enum(["day", "week", "month"]).nullish(),
    limit: z.number().int().min(1).max(20).nullish(),
  }),
]);
export type InsightPlan = z.infer<typeof InsightPlan>;

const MAX_SPAN_DAYS = 366 * 5;

export type CheckedPlan =
  | { tool: "unsupported"; reason: string }
  | {
      tool: "total" | "by_category" | "trend" | "top_payees" | "transactions";
      start: string; // inclusive
      end: string; // exclusive, for the half-open SQL ranges
      lastDay: string; // inclusive, for display
      category: string | null;
      payee: string | null;
      granularity: "day" | "week" | "month";
      limit: number;
    };

function addDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Final checks with the user's real category names and today's date. */
export function checkPlan(raw: unknown, today: string, categories: string[]): CheckedPlan {
  const parsed = InsightPlan.safeParse(raw);
  if (!parsed.success) return { tool: "unsupported", reason: "I couldn't work out how to answer that." };
  const p = parsed.data;
  if (p.tool === "unsupported") return { tool: "unsupported", reason: p.reason || "I can only answer questions about your own transactions." };

  const lastDay = p.to_date > today ? today : p.to_date;
  if (p.from_date > lastDay) return { tool: "unsupported", reason: "That period is in the future." };
  if ((Date.parse(lastDay) - Date.parse(p.from_date)) / 86_400_000 > MAX_SPAN_DAYS) {
    return { tool: "unsupported", reason: "Please ask about a period of five years or less." };
  }
  const category = p.category ?? null;
  if (category !== null && category !== "Uncategorised" && !categories.includes(category)) {
    return { tool: "unsupported", reason: "I couldn't match that to one of your categories." };
  }
  return {
    tool: p.tool,
    start: p.from_date,
    end: addDay(lastDay),
    lastDay,
    category: p.tool === "by_category" ? null : category,
    payee: p.tool === "by_category" || p.tool === "trend" ? null : (p.payee ?? null),
    granularity: p.granularity ?? "month",
    limit: Math.min(p.limit ?? 10, p.tool === "top_payees" ? 10 : 20),
  };
}
