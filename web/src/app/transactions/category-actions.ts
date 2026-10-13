"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth/session";
import { recategoriseAll, setTransactionCategory, type SetCategoryResult } from "@/lib/categorise/service";
import { writeAudit } from "@/lib/audit";
import { checkBudgetsQuietly } from "@/lib/budgets/service";
import { db } from "@/lib/db";

const SetCategoryInput = z.object({
  transactionId: z.uuid(),
  categoryId: z.uuid().nullable(),
  remember: z.boolean(),
});

export async function setCategory(input: z.input<typeof SetCategoryInput>): Promise<SetCategoryResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  const parsed = SetCategoryInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const { transactionId, categoryId, remember } = parsed.data;
  const result = await setTransactionCategory(user.id, transactionId, categoryId, remember, await headers());
  if (result.ok) {
    await checkBudgetsQuietly(user.id); // moving spend between categories changes budgets
    refresh();
  }
  return result;
}

export async function recategorise(): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  const changed = await recategoriseAll(user.id, await headers());
  if (changed) await checkBudgetsQuietly(user.id);
  refresh();
  return { ok: true, changed };
}

export async function deleteRule(ruleId: string): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user || !z.uuid().safeParse(ruleId).success) return { ok: false };
  const h = await headers();
  const deleted = await db.$transaction(async (tx) => {
    // Only the user's own rules; built-in rules (user_id NULL) can't be deleted.
    const r = await tx.categoryRule.deleteMany({ where: { id: ruleId, userId: user.id } });
    if (r.count) await writeAudit(tx, { userId: user.id, action: "rule.delete", entityType: "category_rule", entityId: ruleId }, h);
    return r.count;
  });
  if (deleted) refresh();
  return { ok: deleted > 0 };
}
