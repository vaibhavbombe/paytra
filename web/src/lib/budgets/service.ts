import "server-only";

import { writeAudit } from "@/lib/audit";
import { dateOnlyToDb, isoDateIST } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatPaise, parseRupeesToPaise } from "@/lib/money";
import { periodRange } from "@/lib/periods";
import { Prisma } from "@/generated/prisma/client";

import { BUDGET_SPEND_SQL, budgetLevel, percentUsed, thresholdsReached, type BudgetLevel } from "./spend";

export type BudgetStatus = {
  id: string;
  name: string; // category name or "Overall"
  period: "WEEKLY" | "MONTHLY";
  periodLabel: string;
  periodStart: string;
  limitPaise: bigint;
  spentPaise: bigint;
  percent: number;
  level: BudgetLevel;
  thresholds: number[];
  daysLeft: number; // including today
};

/** All active budgets of a user with this period's spend (computed in SQL). */
export async function getBudgetStatuses(userId: string, today = isoDateIST()): Promise<BudgetStatus[]> {
  const week = periodRange("week", today);
  const month = periodRange("month", today);

  const [budgets, spend] = await Promise.all([
    db.budget.findMany({
      where: { userId, active: true },
      orderBy: [{ categoryId: { sort: "asc", nulls: "first" } }, { period: "asc" }],
      select: { id: true, period: true, limitPaise: true, alertAtPercents: true, category: { select: { name: true } } },
    }),
    db.$queryRawUnsafe<{ budgetId: string; spentPaise: string }[]>(BUDGET_SPEND_SQL, userId, week.start, week.end, month.start, month.end),
  ]);
  const spentById = new Map(spend.map((s) => [s.budgetId, BigInt(s.spentPaise)]));
  const dayMs = 86_400_000;

  return budgets.map((b) => {
    const range = b.period === "WEEKLY" ? week : month;
    const spentPaise = spentById.get(b.id) ?? 0n;
    return {
      id: b.id,
      name: b.category?.name ?? "Overall",
      period: b.period,
      periodLabel: range.label,
      periodStart: range.start,
      limitPaise: b.limitPaise,
      spentPaise,
      percent: percentUsed(spentPaise, b.limitPaise),
      level: budgetLevel(spentPaise, b.limitPaise, b.alertAtPercents),
      thresholds: b.alertAtPercents,
      daysLeft: Math.round((Date.parse(range.end) - Date.parse(today)) / dayMs),
    };
  });
}

/**
 * Record any newly reached thresholds (80% / 100%) for this period.
 * ON CONFLICT DO NOTHING on (budget, period, threshold): safe to call after
 * every change, from anywhere, concurrently; each alert exists once.
 * Returns how many NEW alerts were created (for push/SSE delivery later).
 */
export async function evaluateBudgetAlerts(userId: string): Promise<number> {
  const statuses = await getBudgetStatuses(userId);
  const rows = statuses.flatMap((s) =>
    thresholdsReached(s.spentPaise, s.limitPaise, s.thresholds).map((thresholdPercent) => ({
      budgetId: s.id,
      userId,
      periodStart: dateOnlyToDb(s.periodStart),
      thresholdPercent,
      spentPaise: s.spentPaise,
      limitPaise: s.limitPaise,
    })),
  );
  if (rows.length === 0) return 0;
  const { count } = await db.budgetAlert.createMany({ data: rows, skipDuplicates: true });
  return count;
}

/** Fire-and-forget wrapper: an alert check must never break the action that triggered it. */
export async function checkBudgetsQuietly(userId: string) {
  try {
    await evaluateBudgetAlerts(userId);
  } catch (e) {
    console.error(JSON.stringify({ severity: "ERROR", message: "budget alert check failed", error: String(e) }));
  }
}

export type BudgetFormResult = { ok: true; message: string } | { ok: false; error: string };

export async function createBudget(
  userId: string,
  input: { categoryId: string | null; period: "WEEKLY" | "MONTHLY"; amount: string },
  headers: Headers,
): Promise<BudgetFormResult> {
  const money = parseRupeesToPaise(input.amount);
  if (!money.ok) return { ok: false, error: money.error };

  let name = "Overall";
  if (input.categoryId) {
    // Budgets are for spending: only expense categories (system or the user's own).
    const category = await db.category.findFirst({
      where: { id: input.categoryId, kind: "EXPENSE", OR: [{ userId: null }, { userId }] },
      select: { name: true },
    });
    if (!category) return { ok: false, error: "Choose an expense category." };
    name = category.name;
  }
  if ((await db.budget.count({ where: { userId } })) >= 30) return { ok: false, error: "You can have up to 30 budgets." };

  try {
    await db.$transaction(async (tx) => {
      const b = await tx.budget.create({
        data: { userId, categoryId: input.categoryId, period: input.period, limitPaise: money.paise },
        select: { id: true },
      });
      await writeAudit(
        tx,
        { userId, action: "budget.create", entityType: "budget", entityId: b.id, metadata: { period: input.period, limitPaise: money.paise.toString() } },
        headers,
      );
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: `You already have a ${input.period.toLowerCase()} budget for ${name}.` };
    }
    throw e;
  }
  await checkBudgetsQuietly(userId); // a new budget may already be over 80%
  return { ok: true, message: `${name} budget of ${formatPaise(money.paise)} per ${input.period === "WEEKLY" ? "week" : "month"} saved.` };
}

export async function deleteBudget(userId: string, budgetId: string, headers: Headers) {
  return db.$transaction(async (tx) => {
    const r = await tx.budget.deleteMany({ where: { id: budgetId, userId } }); // own budgets only
    if (r.count) await writeAudit(tx, { userId, action: "budget.delete", entityType: "budget", entityId: budgetId }, headers);
    return r.count > 0;
  });
}

// ── Alerts ──

export async function recentAlerts(userId: string, limit = 10) {
  const rows = await db.budgetAlert.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      thresholdPercent: true,
      spentPaise: true,
      limitPaise: true,
      readAt: true,
      createdAt: true,
      budget: { select: { period: true, category: { select: { name: true } } } },
    },
  });
  return rows.map((a) => ({
    id: a.id,
    unread: a.readAt === null,
    text:
      a.thresholdPercent >= 100
        ? `You've reached your ${a.budget.category?.name ?? "overall"} ${a.budget.period === "WEEKLY" ? "weekly" : "monthly"} budget: ${formatPaise(a.spentPaise)} of ${formatPaise(a.limitPaise)}.`
        : `${a.thresholdPercent}% of your ${a.budget.category?.name ?? "overall"} ${a.budget.period === "WEEKLY" ? "weekly" : "monthly"} budget used: ${formatPaise(a.spentPaise)} of ${formatPaise(a.limitPaise)}.`,
    level: a.thresholdPercent >= 100 ? ("over" as const) : ("warning" as const),
    date: isoDateIST(a.createdAt),
  }));
}

export async function markAlertsRead(userId: string) {
  await db.budgetAlert.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
