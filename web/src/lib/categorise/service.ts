import "server-only";

import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

import { categorise, matchText, prepareRules, type Categorisable, type Rule } from "./engine";

type Tx = Prisma.TransactionClient;

/** Built-in rules + this user's own, sorted most-specific first. */
export async function loadRules(userId: string, client: Tx | typeof db = db): Promise<Rule[]> {
  const rows = await client.categoryRule.findMany({
    where: { OR: [{ userId: null }, { userId }] },
    select: {
      id: true,
      userId: true,
      pattern: true,
      matchType: true,
      direction: true,
      categoryId: true,
      category: { select: { kind: true } },
    },
  });
  return prepareRules(rows.map((r) => ({ ...r, categoryKind: r.category.kind })));
}

/** Category fields for a new transaction (from rules), or none. */
export function ruleCategory(t: Categorisable, rules: Rule[]) {
  const rule = categorise(t, rules);
  return rule
    ? { categoryId: rule.categoryId, categorySource: "RULE" as const, categoryRuleId: rule.id }
    : { categoryId: null, categorySource: null, categoryRuleId: null };
}

/**
 * Re-run rules over the user's transactions that rules are allowed to touch:
 * uncategorised ones and ones a rule set earlier. Never those the user chose.
 * Optionally limited to one normalised payee text.
 */
async function reapply(tx: Tx, userId: string, rules: Rule[], onlyText?: string) {
  const candidates = await tx.transaction.findMany({
    where: { userId, OR: [{ categorySource: null }, { categorySource: "RULE" }] },
    select: { id: true, direction: true, merchant: true, description: true, categoryId: true, categoryRuleId: true },
  });

  // Group by the outcome so each distinct result is one UPDATE.
  const groups = new Map<string, { data: ReturnType<typeof ruleCategory>; ids: string[] }>();
  for (const t of candidates) {
    if (onlyText !== undefined && matchText(t) !== onlyText) continue;
    const data = ruleCategory(t, rules);
    if (data.categoryId === t.categoryId && data.categoryRuleId === t.categoryRuleId) continue; // unchanged
    const key = `${data.categoryId}|${data.categoryRuleId}`;
    const g = groups.get(key) ?? { data, ids: [] };
    g.ids.push(t.id);
    groups.set(key, g);
  }

  let changed = 0;
  for (const { data, ids } of groups.values()) {
    const r = await tx.transaction.updateMany({ where: { id: { in: ids }, userId }, data });
    changed += r.count;
  }
  return changed;
}

/** "Categorise everything": run all rules over everything rules may touch. */
export async function recategoriseAll(userId: string, headers: Headers) {
  return db.$transaction(
    async (tx) => {
      const changed = await reapply(tx, userId, await loadRules(userId, tx));
      await writeAudit(tx, { userId, action: "category.recategorise", metadata: { changed } }, headers);
      return changed;
    },
    { timeout: 30_000 },
  );
}

export type SetCategoryResult =
  | { ok: true; alsoUpdated: number; rememberedFor: string | null }
  | { ok: false; error: string };

/**
 * The user picks a category for one transaction. That choice is final for
 * this transaction (source USER). If `remember`, it also becomes the user's
 * own EXACT rule for this payee + direction, applied to their other matching
 * transactions that weren't set by hand. Clearing (null) never creates a rule.
 */
export async function setTransactionCategory(
  userId: string,
  transactionId: string,
  categoryId: string | null,
  remember: boolean,
  headers: Headers,
): Promise<SetCategoryResult> {
  return db.$transaction(async (tx) => {
    const t = await tx.transaction.findFirst({
      where: { id: transactionId, userId }, // ownership
      select: { id: true, direction: true, merchant: true, description: true, categoryId: true },
    });
    if (!t) return { ok: false, error: "Transaction not found." };

    if (categoryId) {
      const category = await tx.category.findFirst({
        where: { id: categoryId, OR: [{ userId: null }, { userId }] },
        select: { kind: true },
      });
      if (!category) return { ok: false, error: "Category not found." };
      const fits = category.kind === "TRANSFER" || (t.direction === "DEBIT" ? category.kind === "EXPENSE" : category.kind === "INCOME");
      if (!fits) return { ok: false, error: t.direction === "DEBIT" ? "Pick an expense or transfer category." : "Pick an income or transfer category." };
    }

    await tx.transaction.update({
      where: { id: t.id },
      data: categoryId
        ? { categoryId, categorySource: "USER", categoryRuleId: null }
        : { categoryId: null, categorySource: null, categoryRuleId: null },
    });

    let alsoUpdated = 0;
    let rememberedFor: string | null = null;
    const text = matchText(t);
    if (remember && categoryId && text) {
      await tx.categoryRule.upsert({
        where: {
          userId_pattern_matchType_direction: { userId, pattern: text, matchType: "EXACT", direction: t.direction },
        },
        create: { userId, pattern: text, matchType: "EXACT", direction: t.direction, categoryId },
        update: { categoryId },
      });
      rememberedFor = t.merchant ?? t.description;
      alsoUpdated = await reapply(tx, userId, await loadRules(userId, tx), text);
    }

    await writeAudit(
      tx,
      {
        userId,
        action: "transaction.category",
        entityType: "transaction",
        entityId: t.id,
        metadata: { from: t.categoryId, to: categoryId, remembered: Boolean(rememberedFor), alsoUpdated },
      },
      headers,
    );
    return { ok: true, alsoUpdated, rememberedFor };
  });
}
