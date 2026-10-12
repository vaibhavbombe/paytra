import "server-only";

import { ensureCashAccount } from "@/lib/accounts";
import { getSessionUser } from "@/lib/auth/session";
import { dateOnlyToDb, dbDateToIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { periodRange } from "@/lib/periods";
import type { Prisma } from "@/generated/prisma/client";

import type { ListFilters } from "./filters";

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

export const PAGE_SIZE = 50;

/**
 * One page of transactions for the filters, plus totals for the WHOLE
 * filtered period (not just this page). Totals are summed by Postgres over
 * BIGINT paise: exact, and never touched by JavaScript floats.
 */
export async function listTransactions(f: ListFilters) {
  const user = await getSessionUser();
  if (!user) return null;

  const range = periodRange(f.period, f.date);

  const where: Prisma.TransactionWhereInput = {
    userId: user.id, // always scoped to the caller
    txnDate: { gte: dateOnlyToDb(range.start), lt: dateOnlyToDb(range.end) },
    ...(f.direction && { direction: f.direction }),
    ...(f.accountId && { accountId: f.accountId }),
    ...(f.categoryId === "none" ? { categoryId: null } : f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.q && { description: { contains: f.q, mode: "insensitive" as const } }),
  };

  // Money in/out ignore TRANSFER categories (self-transfers, investments),
  // otherwise moving ₹10,000 between your own accounts would count as both
  // ₹10,000 spent and ₹10,000 earned.
  const notTransfer: Prisma.TransactionWhereInput = {
    OR: [{ categoryId: null }, { category: { kind: { not: "TRANSFER" } } }],
  };

  const [rows, sums, transferCount] = await Promise.all([
    db.transaction.findMany({
      where,
      // id as the final tie-breaker gives a stable order for cursor paging.
      orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1, // one extra tells us whether a next page exists
      ...(f.cursor && { cursor: { id: f.cursor }, skip: 1 }),
      select: {
      id: true,
      direction: true,
      amountPaise: true,
      txnDate: true,
      description: true,
      source: true,
        merchant: true,
        categoryId: true,
        categorySource: true,
        category: { select: { name: true, kind: true } },
        account: { select: { nickname: true, institutionName: true, last4: true } },
      },
    }),
    db.transaction.groupBy({
      by: ["direction"],
      where: { AND: [where, notTransfer] },
      _sum: { amountPaise: true },
      _count: { _all: true },
    }),
    db.transaction.count({ where: { AND: [where, { category: { kind: "TRANSFER" } }] } }),
  ]);

  const sumFor = (d: "DEBIT" | "CREDIT") => sums.find((s) => s.direction === d);
  const outPaise = sumFor("DEBIT")?._sum.amountPaise ?? 0n;
  const inPaise = sumFor("CREDIT")?._sum.amountPaise ?? 0n;

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Format on the server: BigInt and Date never reach the client.
  return {
    range,
    totals: {
      moneyIn: formatPaise(inPaise),
      moneyOut: formatPaise(outPaise),
      net: formatPaise(inPaise - outPaise),
      netIsNegative: inPaise < outPaise,
      count: (sumFor("DEBIT")?._count._all ?? 0) + (sumFor("CREDIT")?._count._all ?? 0) + transferCount,
      transferCount,
    },
    rows: page.map((r) => ({
      id: r.id,
      direction: r.direction,
      amount: formatPaise(r.amountPaise),
      date: dbDateToIso(r.txnDate),
      description: r.description,
      category: r.category?.name ?? "Uncategorised",
      categoryId: r.categoryId,
      categorySource: r.categorySource,
      payee: r.merchant ?? r.description,
      isTransfer: r.category?.kind === "TRANSFER",
      account: [r.account.nickname ?? r.account.institutionName, r.account.last4 ? `••${r.account.last4}` : null]
        .filter(Boolean)
        .join(" "),
      source: r.source,
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/** Accounts and categories for the filter dropdowns (no side effects). */
export async function getFilterOptions() {
  const user = await getSessionUser();
  if (!user) return null;

  const [accounts, categories] = await Promise.all([
    db.account.findMany({
      where: { userId: user.id },
      select: { id: true, nickname: true, institutionName: true, last4: true },
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
      label: [a.nickname ?? a.institutionName, a.last4 ? `••${a.last4}` : null].filter(Boolean).join(" "),
    })),
    categories,
  };
}
