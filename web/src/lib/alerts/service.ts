import "server-only";

import { createHash } from "node:crypto";

import { writeAudit } from "@/lib/audit";
import { loadRules, ruleCategory } from "@/lib/categorise/service";
import { dateOnlyToDb, dbDateToIso, isoDateIST } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { periodRange } from "@/lib/periods";
import type { Prisma } from "@/generated/prisma/client";

import type { ParsedAlert } from "./parse";
import { reconcile, scorePair, type RecTxn } from "./reconcile";

type Tx = Prisma.TransactionClient;
type AlertSource = "EMAIL" | "SMS";

export const ALERT_SOURCES = ["EMAIL", "SMS"] as const;
export const BOOK_SOURCES = ["CSV", "PDF", "AA"] as const;

/** Statement references are stored without leading zeros; alerts never have them. */
export const normRef = (r: string | null | undefined) => (r ? r.replace(/^0+/, "").toUpperCase() : null);

/** The user's non-cash accounts whose number ends with the alert's digits (ICICI shows 3). */
export async function accountsForAlert(userId: string, last: string | null) {
  const accounts = await db.account.findMany({
    where: { userId, type: { not: "CASH" } },
    select: { id: true, nickname: true, institutionName: true, last4: true },
    orderBy: { createdAt: "asc" },
  });
  const label = (a: (typeof accounts)[number]) => [a.nickname ?? a.institutionName, a.last4 ? `••${a.last4}` : null].filter(Boolean).join(" ");
  return {
    all: accounts.map((a) => ({ id: a.id, label: label(a) })),
    suggested: last ? (accounts.find((a) => a.last4?.endsWith(last))?.id ?? null) : null,
  };
}

export type IngestResult =
  | { ok: true; status: "created" | "merged" | "duplicate"; message: string }
  | { ok: false; error: string };

/**
 * Save one bank alert for an account. Reconciles at the door:
 *  - same reference already on a statement/AA row  -> MERGE (link this alert
 *    to it; no new transaction), confidence EXACT;
 *  - same alert seen before (fingerprint)          -> DUPLICATE, nothing written;
 *  - otherwise                                     -> new transaction (source
 *    EMAIL/SMS). A later statement import absorbs it on an exact reference, or
 *    the reconciliation page suggests a match for you to confirm.
 */
export async function ingestAlert(userId: string, accountId: string, alert: ParsedAlert, source: AlertSource, headers: Headers): Promise<IngestResult> {
  const account = await db.account.findFirst({ where: { id: accountId, userId, type: { not: "CASH" } }, select: { id: true } });
  if (!account) return { ok: false, error: "Account not found." };
  const txnDate = alert.txnDate && alert.txnDate <= isoDateIST() ? alert.txnDate : isoDateIST();
  const ref = normRef(alert.reference);

  return db.$transaction(async (tx) => {
    // Same per-account lock as statement imports: alert and statement for the
    // same payment can't race each other into two transactions.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"import:" + account.id}))`;

    if (ref) {
      const existing = await tx.transaction.findFirst({
        where: { accountId: account.id, reference: ref, direction: alert.direction, amountPaise: alert.amountPaise },
        select: { id: true, sources: { select: { source: true } } },
      });
      if (existing) {
        if (existing.sources.some((s) => (ALERT_SOURCES as readonly string[]).includes(s.source))) {
          return { ok: true as const, status: "duplicate" as const, message: "This alert was already recorded." };
        }
        await tx.transactionSourceLink.create({ data: { transactionId: existing.id, source, created: false, matchedBy: "EXACT" } });
        await writeAudit(tx, { userId, action: "alert.merge", entityType: "transaction", entityId: existing.id, metadata: { source, matchedBy: "EXACT" } }, headers);
        return { ok: true as const, status: "merged" as const, message: "Matched to a statement entry with the same reference: kept once." };
      }
    }

    // Idempotency key for the alert itself (re-pasting the same alert).
    const key = ref ?? createHash("sha256").update([txnDate, alert.direction, alert.amountPaise.toString(), alert.payee ?? ""].join("|")).digest("hex");
    const fingerprint = `alert:${key}`;
    if (await tx.transaction.findFirst({ where: { accountId: account.id, fingerprint }, select: { id: true } })) {
      return { ok: true as const, status: "duplicate" as const, message: "This alert was already recorded." };
    }

    const rules = await loadRules(userId, tx);
    const description = alert.payee ?? (alert.channel === "OTHER" ? "Bank alert" : `${alert.channel} payment`);
    const txn = await tx.transaction.create({
      data: {
        userId,
        accountId: account.id,
        direction: alert.direction,
        amountPaise: alert.amountPaise,
        txnDate: dateOnlyToDb(txnDate),
        occurredAt: new Date(),
        description,
        merchant: alert.payee,
        reference: ref,
        source,
        fingerprint,
        ...ruleCategory({ direction: alert.direction, merchant: alert.payee, description }, rules),
      },
      select: { id: true },
    });
    await tx.transactionSourceLink.create({ data: { transactionId: txn.id, source, created: true } });
    await writeAudit(tx, { userId, action: "alert.create", entityType: "transaction", entityId: txn.id, metadata: { source } }, headers);
    return { ok: true as const, status: "created" as const, message: `Saved: ${alert.direction === "DEBIT" ? "−" : "+"}${formatPaise(alert.amountPaise)}.` };
  });
}

/**
 * Used by statement/AA imports: for incoming rows with a reference, find an
 * ALERT-only transaction with the same reference, amount and direction in the
 * account. Those rows are absorbed into the alert's transaction instead of
 * creating a second copy of the same payment.
 */
export async function alertOnlyMatchesByReference(tx: Tx, accountId: string, refs: string[]) {
  if (refs.length === 0) return new Map<string, { id: string; amountPaise: bigint; direction: "DEBIT" | "CREDIT" }>();
  const rows = await tx.transaction.findMany({
    where: {
      accountId,
      reference: { in: refs },
      source: { in: [...ALERT_SOURCES] },
      sources: { none: { source: { in: [...BOOK_SOURCES] } } },
    },
    select: { id: true, reference: true, amountPaise: true, direction: true },
  });
  return new Map(rows.map((r) => [r.reference!, { id: r.id, amountPaise: r.amountPaise, direction: r.direction }]));
}

// ── Reconciliation report ──

type Row = RecTxn & { amount: string; label: string; matchedBy: string | null };

export async function reconciliationReport(userId: string, accountId: string, anchor: string) {
  const account = await db.account.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  if (!account) return null;
  const range = periodRange("month", anchor);
  // Look 2 days beyond the month on both sides so month-end payments can pair up.
  const from = new Date(Date.parse(`${range.start}T00:00:00Z`) - 2 * 86_400_000);
  const to = new Date(Date.parse(`${range.end}T00:00:00Z`) + 2 * 86_400_000);

  const txns = await db.transaction.findMany({
    where: { userId, accountId: account.id, txnDate: { gte: from, lt: to } },
    orderBy: [{ txnDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      direction: true,
      amountPaise: true,
      txnDate: true,
      reference: true,
      merchant: true,
      description: true,
      sources: { select: { source: true, matchedBy: true } },
    },
  });

  const inMonth = (iso: string) => iso >= range.start && iso < range.end;
  const toRow = (t: (typeof txns)[number]): Row => ({
    id: t.id,
    accountId: account.id,
    direction: t.direction,
    amountPaise: t.amountPaise,
    txnDate: dbDateToIso(t.txnDate),
    reference: t.reference,
    payee: t.merchant ?? t.description,
    amount: formatPaise(t.amountPaise),
    label: t.merchant ?? t.description,
    matchedBy: t.sources.find((s) => s.matchedBy)?.matchedBy ?? null,
  });

  const hasAlert = (t: (typeof txns)[number]) => t.sources.some((s) => (ALERT_SOURCES as readonly string[]).includes(s.source));
  const hasBook = (t: (typeof txns)[number]) => t.sources.some((s) => (BOOK_SOURCES as readonly string[]).includes(s.source));

  const both = txns.filter((t) => hasAlert(t) && hasBook(t)).map(toRow).filter((r) => inMonth(r.txnDate));
  const alertOnly = txns.filter((t) => hasAlert(t) && !hasBook(t)).map(toRow);
  const bookOnly = txns.filter((t) => hasBook(t) && !hasAlert(t)).map(toRow);

  // Live suggestions for what hasn't been merged yet.
  const live = reconcile(alertOnly, bookOnly);
  const suggestions = live.matched.filter((m) => inMonth(m.alert.txnDate) || inMonth(m.book.txnDate));
  const onlyAlert = live.onlyAlert.filter((r) => inMonth(r.txnDate)) as Row[];
  const onlyBook = live.onlyBook.filter((r) => inMonth(r.txnDate)) as Row[];
  const ambiguous = live.ambiguous.filter((a) => inMonth(a.alert.txnDate));

  const sum = (rows: RecTxn[]) => formatPaise(rows.reduce((s, r) => s + (r.direction === "DEBIT" ? -r.amountPaise : r.amountPaise), 0n));

  return {
    range,
    matched: both,
    suggestions: suggestions.map((m) => ({ alert: m.alert as Row, book: m.book as Row, dayDiff: m.dayDiff })),
    ambiguous: ambiguous.map((a) => ({ alert: a.alert as Row, candidates: a.candidates as Row[] })),
    onlyAlert,
    onlyBook,
    totals: {
      matched: both.length,
      suggestions: suggestions.length,
      onlyAlert: onlyAlert.length,
      onlyBook: onlyBook.length,
      onlyAlertNet: sum(onlyAlert),
    },
  };
}

/**
 * The user accepts a suggested match: the alert's transaction is merged into
 * the statement's (the bank statement is the record of truth), its source
 * links move across marked CONFIRMED, and the duplicate is deleted. One DB
 * transaction; verified again server-side, never trusting the client.
 */
export async function confirmMatch(userId: string, alertTxnId: string, bookTxnId: string, headers: Headers) {
  return db.$transaction(async (tx) => {
    const [alert, book] = await Promise.all(
      [alertTxnId, bookTxnId].map((id) =>
        tx.transaction.findFirst({
          where: { id, userId },
          select: {
            id: true,
            accountId: true,
            direction: true,
            amountPaise: true,
            txnDate: true,
            reference: true,
            merchant: true,
            description: true,
            categoryId: true,
            categorySource: true,
            sources: { select: { source: true } },
          },
        }),
      ),
    );
    if (!alert || !book) return { ok: false as const, error: "Transaction not found." };
    const isAlert = alert.sources.some((s) => (ALERT_SOURCES as readonly string[]).includes(s.source)) && !alert.sources.some((s) => (BOOK_SOURCES as readonly string[]).includes(s.source));
    const isBook = book.sources.some((s) => (BOOK_SOURCES as readonly string[]).includes(s.source)) && !book.sources.some((s) => (ALERT_SOURCES as readonly string[]).includes(s.source));
    const asRec = (t: NonNullable<typeof alert>): RecTxn => ({ id: t.id, accountId: t.accountId, direction: t.direction, amountPaise: t.amountPaise, txnDate: dbDateToIso(t.txnDate), reference: t.reference, payee: t.merchant ?? t.description });
    if (!isAlert || !isBook || !scorePair(asRec(alert), asRec(book))) return { ok: false as const, error: "These two entries can't be the same payment." };

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"import:" + book.accountId}))`;
    await tx.transactionSourceLink.updateMany({ where: { transactionId: alert.id }, data: { transactionId: book.id, matchedBy: "CONFIRMED", created: false } });
    // Keep a category the user chose on the alert if the statement row has none of theirs.
    if (alert.categorySource === "USER" && book.categorySource !== "USER") {
      await tx.transaction.update({ where: { id: book.id }, data: { categoryId: alert.categoryId, categorySource: "USER", categoryRuleId: null } });
    }
    await tx.transaction.delete({ where: { id: alert.id } });
    await writeAudit(tx, { userId, action: "reconcile.confirm", entityType: "transaction", entityId: book.id, metadata: { mergedFrom: alert.id } }, headers);
    return { ok: true as const };
  });
}
