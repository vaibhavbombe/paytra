import "server-only";

import { aiPlanInsight } from "@/lib/ai/client";
import { writeAudit } from "@/lib/audit";
import { isoDateIST } from "@/lib/dates";
import { db } from "@/lib/db";

import { byCategoryAnswer, topPayeesAnswer, totalAnswer, transactionsAnswer, trendAnswer, type Answer } from "./answer";
import { checkPlan, type CheckedPlan } from "./plan";
import { byCategoryQuery, topPayeesQuery, totalQuery, transactionsQuery, trendQuery, type Query } from "./sql";

export type InsightResult = { kind: "answer"; tool: string; answer: Answer } | { kind: "unsupported"; reason: string };

const run = <T,>(q: Query) => db.$queryRawUnsafe<T[]>(q.sql, ...q.params);

/** Execute a checked plan for this user only. Every query is scoped by user id. */
export async function runPlan(userId: string, p: Exclude<CheckedPlan, { tool: "unsupported" }>): Promise<Answer> {
  const f = { category: p.category, payee: p.payee };
  switch (p.tool) {
    case "total": {
      const [r] = await run<{ spend: string; income: string; count: number }>(totalQuery(userId, p.start, p.end, f));
      return totalAnswer(p, r);
    }
    case "by_category":
      return byCategoryAnswer(p, await run(byCategoryQuery(userId, p.start, p.end)));
    case "trend":
      return trendAnswer(p, await run(trendQuery(userId, p.start, p.end, p.granularity, f)));
    case "top_payees":
      return topPayeesAnswer(p, await run(topPayeesQuery(userId, p.start, p.end, p.limit, f)));
    case "transactions":
      return transactionsAnswer(p, await run(transactionsQuery(userId, p.start, p.end, p.limit, f)));
  }
}

/**
 * Question → (AI) plan → (PayTra) checked plan → SQL → answer written by
 * PayTra. The AI sees the question, today's date and category names only.
 */
export async function askInsight(userId: string, question: string, headers: Headers): Promise<InsightResult> {
  const today = isoDateIST();
  const categories = [
    ...new Set(
      (await db.category.findMany({ where: { OR: [{ userId: null }, { userId }] }, select: { name: true } })).map((c) => c.name),
    ),
  ];
  const { plan: raw, model } = await aiPlanInsight(question, today, categories);
  const plan = checkPlan(raw, today, categories);

  // Audit: which tool ran, never the question text (it can be personal).
  await db.$transaction((tx) =>
    writeAudit(tx, { userId, action: "insights.ask", metadata: { tool: plan.tool, model } }, headers),
  );

  if (plan.tool === "unsupported") return { kind: "unsupported", reason: plan.reason };
  return { kind: "answer", tool: plan.tool, answer: await runPlan(userId, plan) };
}
