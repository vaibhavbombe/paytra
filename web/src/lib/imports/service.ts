import "server-only";

import { createHash } from "node:crypto";

import { writeAudit } from "@/lib/audit";
import { dateOnlyToDb, dbDateToIso, isoDateIST } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";

import { readPdfStatement } from "./pdf";
import {
  parseStatement,
  parseStatementTable,
  type BalanceCheck,
  type ParsedStatement,
  type RowError,
  type StatementRow,
} from "./statement";

export const MAX_FILE_BYTES = 1024 * 1024; // 1 MB ≈ several years of rows

export const MAX_PDF_PASSWORD = 64;

type Analysis =
  | { ok: false; error: string; needsPassword?: boolean }
  | {
      ok: true;
      accountId: string;
      fileName: string;
      fileSha256: string;
      source: "CSV" | "PDF";
      rows: StatementRow[];
      errors: RowError[];
      balance: BalanceCheck;
      period: { from: string; to: string } | null;
      existing: Set<string>; // fingerprints already in the account
      previousImport: string | null; // date this exact file was imported before
    };

/**
 * Validate the upload and parse it. Shared by preview and commit so both see
 * exactly the same rows. The file is held in memory only and never stored.
 */
async function analyse(userId: string, accountId: unknown, file: unknown, pdfPassword: unknown): Promise<Analysis> {
  if (typeof accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(accountId)) {
    return { ok: false, error: "Choose an account." };
  }
  // Authorisation: only the caller's own, non-cash accounts.
  const account = await db.account.findFirst({
    where: { id: accountId, userId, type: { not: "CASH" } },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "Account not found." };

  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV or PDF file." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "File is larger than 1 MB. Export a shorter period." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileSha256 = createHash("sha256").update(bytes).digest("hex");
  // Decide by CONTENT, not just the extension: a PDF always starts with "%PDF-".
  const isPdf = bytes.length > 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";

  let parsed: ParsedStatement;
  if (isPdf) {
    if (!/\.pdf$/i.test(file.name)) return { ok: false, error: "That file is a PDF; rename it to .pdf or choose the CSV." };
    // The statement's own file password (often DOB / customer ID): used once,
    // in memory, to open this file. Never stored, logged or audited.
    const password = typeof pdfPassword === "string" && pdfPassword ? pdfPassword.slice(0, MAX_PDF_PASSWORD) : undefined;
    const pdf = await readPdfStatement(bytes, password);
    if (!pdf.ok) {
      return {
        ok: false,
        error: pdf.message,
        needsPassword: pdf.reason === "password-required" || pdf.reason === "password-incorrect",
      };
    }
    parsed = parseStatementTable(pdf.table, account.id, isoDateIST());
  } else {
    if (!/\.csv$/i.test(file.name)) return { ok: false, error: "Only .csv and .pdf statements are supported." };
    // Binary files (e.g. a renamed XLSX) contain NUL bytes; CSV never does.
    if (bytes.includes(0)) return { ok: false, error: "That doesn't look like a CSV text file." };
    parsed = parseStatement(new TextDecoder("utf-8").decode(bytes), account.id, isoDateIST());
  }
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.rows.length === 0 && parsed.errors.length === 0) {
    return { ok: false, error: "No transactions found in the file." };
  }

  const fingerprints = parsed.rows.map((r) => r.fingerprint);
  const [found, previous] = await Promise.all([
    fingerprints.length
      ? db.transaction.findMany({
          where: { accountId: account.id, fingerprint: { in: fingerprints } },
          select: { fingerprint: true },
        })
      : [],
    db.importBatch.findFirst({
      where: { accountId: account.id, fileSha256 },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    ok: true,
    accountId: account.id,
    fileName: file.name.slice(0, 200),
    fileSha256,
    source: isPdf ? "PDF" : "CSV",
    rows: parsed.rows,
    errors: parsed.errors,
    balance: parsed.balance,
    period: parsed.period,
    existing: new Set(found.map((f) => f.fingerprint)),
    previousImport: previous ? isoDateIST(previous.createdAt) : null,
  };
}

export type ImportPreview = {
  fileName: string;
  source: "CSV" | "PDF";
  period: { from: string; to: string } | null;
  total: number;
  newCount: number;
  duplicateCount: number;
  errors: RowError[];
  balance: BalanceCheck;
  previousImport: string | null;
  newIn: string;
  newOut: string;
  sample: {
    line: number;
    date: string;
    description: string;
    direction: "DEBIT" | "CREDIT";
    amount: string;
    duplicate: boolean;
  }[];
};

export async function previewImport(userId: string, accountId: unknown, file: unknown, pdfPassword: unknown) {
  const a = await analyse(userId, accountId, file, pdfPassword);
  if (!a.ok) return a;

  const fresh = a.rows.filter((r) => !a.existing.has(r.fingerprint));
  const sum = (d: "DEBIT" | "CREDIT") => fresh.filter((r) => r.direction === d).reduce((s, r) => s + r.amountPaise, 0n);

  const preview: ImportPreview = {
    fileName: a.fileName,
    source: a.source,
    period: a.period,
    total: a.rows.length,
    newCount: fresh.length,
    duplicateCount: a.rows.length - fresh.length,
    errors: a.errors.slice(0, 50),
    balance: a.balance,
    previousImport: a.previousImport,
    newIn: formatPaise(sum("CREDIT")),
    newOut: formatPaise(sum("DEBIT")),
    sample: a.rows.slice(0, 100).map((r) => ({
      line: r.line,
      date: r.txnDate,
      description: r.description,
      direction: r.direction,
      amount: formatPaise(r.amountPaise),
      duplicate: a.existing.has(r.fingerprint),
    })),
  };
  return { ok: true as const, preview };
}

export async function commitImport(
  userId: string,
  accountId: unknown,
  file: unknown,
  pdfPassword: unknown,
  headers: Headers,
) {
  const a = await analyse(userId, accountId, file, pdfPassword);
  if (!a.ok) return a;
  if (a.rows.length === 0) return { ok: false as const, error: "No valid rows to import." };

  const result = await db.$transaction(
    async (tx) => {
      // Serialise imports per account: two uploads at once can't race on
      // "which rows are new", so the counts and links are exact.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"import:" + a.accountId}))`;

      const fingerprints = a.rows.map((r) => r.fingerprint);
      const before = new Set(
        (
          await tx.transaction.findMany({
            where: { accountId: a.accountId, fingerprint: { in: fingerprints } },
            select: { fingerprint: true },
          })
        ).map((t) => t.fingerprint),
      );

      // ON CONFLICT (account_id, fingerprint) DO NOTHING: the database itself
      // guarantees no duplicates, whatever happens above.
      const { count: inserted } = await tx.transaction.createMany({
        data: a.rows
          .filter((r) => !before.has(r.fingerprint))
          .map((r) => ({
            userId,
            accountId: a.accountId,
            direction: r.direction,
            amountPaise: r.amountPaise,
            txnDate: dateOnlyToDb(r.txnDate),
            description: r.description,
            merchant: r.merchant,
            reference: r.reference,
            source: a.source,
            fingerprint: r.fingerprint,
          })),
        skipDuplicates: true,
      });

      const batch = await tx.importBatch.create({
        data: {
          userId,
          accountId: a.accountId,
          source: a.source,
          fileName: a.fileName,
          fileSha256: a.fileSha256,
          periodFrom: a.period ? dateOnlyToDb(a.period.from) : null,
          periodTo: a.period ? dateOnlyToDb(a.period.to) : null,
          rowCount: a.rows.length,
          insertedCount: inserted,
          duplicateCount: a.rows.length - inserted,
          errorCount: a.errors.length,
          balanceCheck: a.balance.status,
        },
        select: { id: true },
      });

      // Link every row (new or already known) to this import.
      const ids = new Map(
        (
          await tx.transaction.findMany({
            where: { accountId: a.accountId, fingerprint: { in: fingerprints } },
            select: { id: true, fingerprint: true },
          })
        ).map((t) => [t.fingerprint, t.id]),
      );
      await tx.transactionSourceLink.createMany({
        data: a.rows.map((r) => ({
          transactionId: ids.get(r.fingerprint)!,
          importBatchId: batch.id,
          source: a.source,
          sourceLine: r.line,
          created: !before.has(r.fingerprint),
        })),
        skipDuplicates: true,
      });

      await writeAudit(
        tx,
        {
          userId,
          action: "import.commit",
          entityType: "import_batch",
          entityId: batch.id,
          metadata: {
            source: a.source,
            rows: a.rows.length,
            inserted,
            duplicates: a.rows.length - inserted,
            errors: a.errors.length,
            balanceCheck: a.balance.status,
            fileSha256: a.fileSha256,
          },
        },
        headers,
      );

      return { inserted, duplicates: a.rows.length - inserted, errors: a.errors.length };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  return { ok: true as const, ...result };
}

export async function recentImports(userId: string) {
  const rows = await db.importBatch.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      fileName: true,
      periodFrom: true,
      periodTo: true,
      rowCount: true,
      insertedCount: true,
      duplicateCount: true,
      errorCount: true,
      balanceCheck: true,
      createdAt: true,
      account: { select: { nickname: true, institutionName: true, last4: true } },
    },
  });
  return rows.map((b) => ({
    id: b.id,
    fileName: b.fileName,
    period: b.periodFrom && b.periodTo ? `${dbDateToIso(b.periodFrom)} → ${dbDateToIso(b.periodTo)}` : "—",
    account: [b.account.nickname ?? b.account.institutionName, b.account.last4 ? `••${b.account.last4}` : null]
      .filter(Boolean)
      .join(" "),
    rows: b.rowCount,
    inserted: b.insertedCount,
    duplicates: b.duplicateCount,
    errors: b.errorCount,
    balanceCheck: b.balanceCheck,
    importedOn: isoDateIST(b.createdAt),
  }));
}
