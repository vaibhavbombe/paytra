import "server-only";

import { ensureCashAccount } from "@/lib/accounts";
import { getSessionUser } from "@/lib/auth/session";
import { dbDateToIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";

// Every query resolves the user itself, so a caller can't ask for someone
// else's data by passing a different ID.

export async function getFormOptions() {
  const user = await getSessionUser();
  if (!user) return null;

  await db.$transaction((tx) => ensureCashAccount(tx, user.id));

  const [accounts, categories] = await Promise.all([
    db.account.findMany({
      where: { userId: user.id },
      select: { id: true, nickname: true, institutionName: true, type: true, last4: true },
      orderBy: { createdAt: "asc" },
    }),
    db.category.findMany({
      where: { OR: [{ userId: null }, { userId: user.id }] },
      select: { id: true, name: true, kind: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
  ]);

  return {
    accounts: accounts.map((a) => ({
      id: a.id,
      // Masked: only ever the last 4 digits.
      label: [a.nickname ?? a.institutionName, a.last4 ? `••${a.last4}` : null].filter(Boolean).join(" "),
    })),
    categories,
  };
}

export async function getRecentTransactions(limit = 20) {
  const user = await getSessionUser();
  if (!user) return null;

  const rows = await db.transaction.findMany({
    where: { userId: user.id },
    orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      direction: true,
      amountPaise: true,
      txnDate: true,
      description: true,
      source: true,
      category: { select: { name: true } },
      account: { select: { nickname: true, institutionName: true, last4: true } },
    },
  });

  // Format on the server: BigInt and Date never reach the client.
  return rows.map((r) => ({
    id: r.id,
    direction: r.direction,
    amount: formatPaise(r.amountPaise),
    date: dbDateToIso(r.txnDate),
    description: r.description,
    category: r.category?.name ?? "Uncategorised",
    account: [r.account.nickname ?? r.account.institutionName, r.account.last4 ? `••${r.account.last4}` : null]
      .filter(Boolean)
      .join(" "),
    source: r.source,
  }));
}
