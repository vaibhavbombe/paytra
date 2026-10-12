import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/**
 * Makes sure the user has exactly one "Cash" account for manual entries.
 * Called at login and lazily when the form loads (for users who signed up
 * before this existed). A per-user advisory lock serialises concurrent
 * callers, so two tabs loading at once can't create two Cash accounts.
 */
export async function ensureCashAccount(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"cash:" + userId}))`;

  const existing = await tx.account.findFirst({
    where: { userId, type: "CASH" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await tx.account.create({
    data: { userId, type: "CASH", institutionName: "Cash", nickname: "Cash" },
    select: { id: true },
  });
  return created.id;
}
