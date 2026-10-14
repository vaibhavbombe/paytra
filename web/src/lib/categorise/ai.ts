import "server-only";

import { aiCategorise } from "@/lib/ai/client";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";

import { aiCategoryOptions, aiUpdates, planAiBatch } from "./ai-plan";

export type AiCategoriseResult = { payeesSent: number; categorised: number; unsure: number; leftOver: number };

/**
 * Ask the AI service about payees that rules didn't recognise, and apply its
 * confident answers as source AI. The network call happens outside any DB
 * transaction; the writes only touch rows that are still uncategorised, so a
 * category the user picked meanwhile is never overwritten.
 */
export async function aiCategoriseUncategorised(userId: string, headers: Headers): Promise<AiCategoriseResult> {
  const [txs, categories] = await Promise.all([
    db.transaction.findMany({
      where: { userId, categoryId: null },
      select: { id: true, direction: true, merchant: true, description: true },
    }),
    db.category.findMany({
      where: { OR: [{ userId: null }, { userId }] },
      select: { id: true, name: true, kind: true, userId: true },
    }),
  ]);
  const plan = planAiBatch(txs);
  if (plan.items.length === 0) return { payeesSent: 0, categorised: 0, unsure: 0, leftOver: 0 };

  const { options, byName } = aiCategoryOptions(categories);
  const response = await aiCategorise(plan.items, options);
  const { updates, unsure } = aiUpdates(plan, response.suggestions, byName);

  const categorised = await db.$transaction(async (tx) => {
    let n = 0;
    for (const [categoryId, ids] of updates) {
      const r = await tx.transaction.updateMany({
        where: { id: { in: ids }, userId, categoryId: null },
        data: { categoryId, categorySource: "AI", categoryRuleId: null },
      });
      n += r.count;
    }
    await writeAudit(
      tx,
      {
        userId,
        action: "category.ai_suggest",
        // Counts and model only: no payee names in the audit log.
        metadata: { model: response.model, payeesSent: plan.items.length, categorised: n, unsure, mockDataConfirmed: true },
      },
      headers,
    );
    return n;
  });

  return { payeesSent: plan.items.length, categorised, unsure, leftOver: plan.leftOver };
}
