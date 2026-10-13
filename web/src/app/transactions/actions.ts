"use server";

import { refresh } from "next/cache";

import { writeAudit } from "@/lib/audit";
import { checkBudgetsQuietly } from "@/lib/budgets/service";
import { loadRules, ruleCategory } from "@/lib/categorise/service";
import { getSessionUser } from "@/lib/auth/session";
import { dateOnlyToDb } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import {
  categoryFitsDirection,
  parseManualTransaction,
  type FieldErrors,
} from "@/lib/transactions/input";
import { Prisma } from "@/generated/prisma/client";

export type AddTransactionState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors?: FieldErrors }
  | { status: "saved"; message: string };

// Server Actions are POST endpoints: Next.js rejects calls whose Origin
// doesn't match the host (CSRF), but authentication, authorisation and
// validation are still our job, every time.
export async function addTransaction(formData: FormData): Promise<AddTransactionState> {
  const user = await getSessionUser();
  if (!user) return { status: "error", message: "Your session has expired. Please sign in again." };

  const parsed = parseManualTransaction(Object.fromEntries(formData));
  if (!parsed.ok) {
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: parsed.fieldErrors };
  }
  const input = parsed.data;

  // Authorisation: the account must be the caller's own. Never trust an ID
  // from the browser (IDOR).
  const account = await db.account.findFirst({
    where: { id: input.accountId, userId: user.id },
    select: { id: true },
  });
  if (!account) return { status: "error", message: "Account not found." };

  if (input.categoryId) {
    const category = await db.category.findFirst({
      where: { id: input.categoryId, OR: [{ userId: null }, { userId: user.id }] },
      select: { kind: true },
    });
    if (!category) return { status: "error", message: "Category not found." };
    if (!categoryFitsDirection(category.kind, input.direction)) {
      return {
        status: "error",
        message: "That category doesn't match the direction.",
        fieldErrors: { categoryId: input.direction === "DEBIT" ? "Pick an expense category" : "Pick an income category" },
      };
    }
  }

  const fingerprint = `manual:${input.requestId}`;
  const rules = input.categoryId ? [] : await loadRules(user.id);
  try {
    await db.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          direction: input.direction,
          amountPaise: input.amountPaise,
          txnDate: dateOnlyToDb(input.txnDate),
          occurredAt: new Date(),
          description: input.description,
          ...(input.categoryId
            ? { categoryId: input.categoryId, categorySource: "USER" as const }
            : ruleCategory({ direction: input.direction, merchant: null, description: input.description }, rules)),
          notes: input.notes,
          source: "MANUAL",
          fingerprint,
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        userId: user.id,
        action: "transaction.create",
        entityType: "transaction",
        entityId: txn.id,
        // BigInt isn't JSON; store paise as a string.
        metadata: { source: "MANUAL", direction: input.direction, amountPaise: input.amountPaise.toString() },
      });
    });
  } catch (e) {
    // Same requestId already saved (double-click / retry): that's success, not
    // an error, and nothing new was written.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { status: "saved", message: "Already saved." };
    }
    throw e;
  }

  await checkBudgetsQuietly(user.id);
  refresh();
  const verb = input.direction === "DEBIT" ? "Spent" : "Received";
  return { status: "saved", message: `${verb} ${formatPaise(input.amountPaise)} saved.` };
}
