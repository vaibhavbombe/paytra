"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth/session";
import { createBudget, deleteBudget, markAlertsRead, type BudgetFormResult } from "@/lib/budgets/service";

const BudgetInput = z.object({
  categoryId: z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v)),
  period: z.enum(["WEEKLY", "MONTHLY"]),
  amount: z.string().max(30),
});

export async function addBudget(formData: FormData): Promise<BudgetFormResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  const parsed = BudgetInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Please check the form." };
  const result = await createBudget(user.id, parsed.data, await headers());
  if (result.ok) refresh();
  return result;
}

export async function removeBudget(budgetId: string): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user || !z.uuid().safeParse(budgetId).success) return { ok: false };
  const ok = await deleteBudget(user.id, budgetId, await headers());
  if (ok) refresh();
  return { ok };
}

export async function dismissAlerts(): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  await markAlertsRead(user.id);
  refresh();
}
