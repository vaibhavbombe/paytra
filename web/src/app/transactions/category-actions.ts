"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { AiUnavailable, aiConfigured } from "@/lib/ai/client";
import { getSessionUser } from "@/lib/auth/session";
import { aiCategoriseUncategorised, type AiCategoriseResult } from "@/lib/categorise/ai";
import { recategoriseAll, setTransactionCategory, type SetCategoryResult } from "@/lib/categorise/service";
import { writeAudit } from "@/lib/audit";
import { checkBudgetsQuietly } from "@/lib/budgets/service";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

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

export async function aiSuggestCategories(acknowledged: boolean): Promise<
  { ok: true; result: AiCategoriseResult } | { ok: false; error: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  if (!aiConfigured()) return { ok: false, error: "AI suggestions aren't set up on this server." };
  // Consent first: the free-tier model may use inputs, so the user must say so.
  if (acknowledged !== true) return { ok: false, error: "Please confirm before sending payee names to the AI." };
  const h = await headers();
  // Each click is an external model call: keep it to a few an hour.
  if (!rateLimit(`ai-categorise:${user.id}:${clientIp(h)}`, 10, 60 * 60_000).ok) {
    return { ok: false, error: "Too many AI requests. Try again later." };
  }
  try {
    const result = await aiCategoriseUncategorised(user.id, h);
    if (result.categorised) {
      await checkBudgetsQuietly(user.id);
      refresh();
    }
    return { ok: true, result };
  } catch (e) {
    if (e instanceof AiUnavailable) return { ok: false, error: "The AI service isn't available right now. Rules still work." };
    throw e;
  }
}
