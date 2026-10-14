import "server-only";

import { randomUUID } from "node:crypto";

import { writeAudit } from "@/lib/audit";
import { dateOnlyToDb, dbDateToIso, isoDateIST } from "@/lib/dates";
import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { alertOnlyMatchesByReference, normRef } from "@/lib/alerts/service";
import { loadRules, ruleCategory } from "@/lib/categorise/service";
import { signedUploadUrl } from "@/lib/storage";
import { Prisma } from "@/generated/prisma/client";

import {
  fromStored,
  kindFromName,
  MAX_FILE_BYTES,
  parseFile,
  type ParsedFile,
  type StoredResult,
} from "./core";
import type { BalanceCheck, RowError } from "./statement";

export { MAX_FILE_BYTES };

type Parsed = Extract<ParsedFile, { ok: true }>;
/** What commitRows needs: a parsed statement from a file (CSV/PDF) or from the Account Aggregator. */
type CommitInput = Omit<Parsed, "source"> & { source: Parsed["source"] | "AA" };
type Failure = { ok: false; error: string; needsPassword?: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_TTL_MS = 24 * 60 * 60 * 1000; // a parsed preview waits at most a day

/** Authorisation: the account must be the caller's own, non-cash account. */
async function ownedImportAccount(userId: string, accountId: unknown) {
  if (typeof accountId !== "string" || !UUID_RE.test(accountId)) return null;
  return db.account.findFirst({
    where: { id: accountId, userId, type: { not: "CASH" } },
    select: { id: true },
  });
}

// ── Preview (shared by the direct path and the job path) ──

export type ImportPreview = {
  fileName: string;
  source: "CSV" | "PDF";
  period: { from: string; to: string } | null;
  total: number;
  newCount: number;
  duplicateCount: number;
  alertMatchCount: number; // rows that confirm transactions first seen in bank alerts
  errors: RowError[];
  balance: BalanceCheck;
  previousImport: string | null;
  newIn: string;
  newOut: string;
  sample: { line: number; date: string; description: string; direction: "DEBIT" | "CREDIT"; amount: string; duplicate: boolean; alertMatch: boolean }[];
};

/** Which rows are new is decided NOW against the database, not at parse time. */
async function buildPreview(accountId: string, fileName: string, p: Parsed): Promise<ImportPreview> {
  const fingerprints = p.rows.map((r) => r.fingerprint);
  const [found, previous] = await Promise.all([
    fingerprints.length
      ? db.transaction.findMany({ where: { accountId, fingerprint: { in: fingerprints } }, select: { fingerprint: true } })
      : [],
    db.importBatch.findFirst({
      where: { accountId, fileSha256: p.fileSha256 },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const existing = new Set(found.map((f) => f.fingerprint));
  // Rows that a saved bank alert already recorded (same reference): they
  // won't create new transactions, they confirm the alert's.
  const alertRefs = await alertOnlyMatchesByReference(
    db,
    accountId,
    [...new Set(p.rows.filter((r) => !existing.has(r.fingerprint) && r.reference).map((r) => normRef(r.reference)!))],
  );
  const alertMatched = new Set(
    p.rows
      .filter((r) => {
        const m = !existing.has(r.fingerprint) && r.reference ? alertRefs.get(normRef(r.reference)!) : undefined;
        return m && m.amountPaise === r.amountPaise && m.direction === r.direction;
      })
      .map((r) => r.fingerprint),
  );
  const fresh = p.rows.filter((r) => !existing.has(r.fingerprint) && !alertMatched.has(r.fingerprint));
  const sum = (d: "DEBIT" | "CREDIT") => fresh.filter((r) => r.direction === d).reduce((s, r) => s + r.amountPaise, 0n);

  return {
    fileName,
    source: p.source,
    period: p.period,
    total: p.rows.length,
    newCount: fresh.length,
    duplicateCount: p.rows.length - fresh.length - alertMatched.size,
    alertMatchCount: alertMatched.size,
    errors: p.errors.slice(0, 50),
    balance: p.balance,
    previousImport: previous ? isoDateIST(previous.createdAt) : null,
    newIn: formatPaise(sum("CREDIT")),
    newOut: formatPaise(sum("DEBIT")),
    sample: p.rows.slice(0, 100).map((r) => ({
      line: r.line,
      date: r.txnDate,
      description: r.description,
      direction: r.direction,
      amount: formatPaise(r.amountPaise),
      duplicate: existing.has(r.fingerprint),
      alertMatch: alertMatched.has(r.fingerprint),
    })),
  };
}

// ── Commit (shared) ──

async function commitRows(userId: string, accountId: string, fileName: string, p: CommitInput, headers: Headers, jobId?: string) {
  if (p.rows.length === 0) return { ok: false as const, error: "No valid rows to import." };

  const result = await db.$transaction(
    async (tx) => {
      // Serialise imports per account: two uploads at once can't race on
      // "which rows are new", so the counts and links are exact.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"import:" + accountId}))`;

      if (jobId) {
        // Claim the job inside the same transaction: a double-click on
        // Import can't commit the same job twice.
        const claimed = await tx.importJob.updateMany({
          where: { id: jobId, userId, status: "READY" },
          data: { status: "PARSING" },
        });
        if (claimed.count === 0) return null;
      }

      const rules = await loadRules(userId, tx);
      const fingerprints = p.rows.map((r) => r.fingerprint);
      const before = new Set(
        (await tx.transaction.findMany({ where: { accountId, fingerprint: { in: fingerprints } }, select: { fingerprint: true } })).map(
          (t) => t.fingerprint,
        ),
      );

      // Reconciliation at the door: a row whose reference matches a payment
      // we only know from a bank ALERT is the same payment. The alert's
      // transaction absorbs the row (statement is the record of truth: its
      // date and fingerprint win) instead of a second copy being created.
      const alertMatches = await alertOnlyMatchesByReference(
        tx,
        accountId,
        [...new Set(p.rows.filter((r) => !before.has(r.fingerprint) && r.reference).map((r) => normRef(r.reference)!))],
      );
      const absorbed = new Set<string>();
      for (const r of p.rows) {
        const m = !before.has(r.fingerprint) && r.reference ? alertMatches.get(normRef(r.reference)!) : undefined;
        if (!m || m.amountPaise !== r.amountPaise || m.direction !== r.direction) continue;
        await tx.transaction.update({
          where: { id: m.id },
          data: { fingerprint: r.fingerprint, txnDate: dateOnlyToDb(r.txnDate), reference: r.reference },
        });
        alertMatches.delete(normRef(r.reference)!); // one alert absorbs one row
        absorbed.add(r.fingerprint);
        before.add(r.fingerprint);
      }

      // ON CONFLICT (account_id, fingerprint) DO NOTHING: the database itself
      // guarantees no duplicates, whatever happens above.
      const { count: inserted } = await tx.transaction.createMany({
        data: p.rows
          .filter((r) => !before.has(r.fingerprint))
          .map((r) => ({
            userId,
            accountId,
            direction: r.direction,
            amountPaise: r.amountPaise,
            txnDate: dateOnlyToDb(r.txnDate),
            description: r.description,
            merchant: r.merchant,
            reference: r.reference,
            source: p.source,
            fingerprint: r.fingerprint,
            // Rules first; anything unmatched stays uncategorised for now.
            ...ruleCategory(r, rules),
          })),
        skipDuplicates: true,
      });

      const batch = await tx.importBatch.create({
        data: {
          userId,
          accountId,
          source: p.source,
          fileName,
          fileSha256: p.fileSha256,
          periodFrom: p.period ? dateOnlyToDb(p.period.from) : null,
          periodTo: p.period ? dateOnlyToDb(p.period.to) : null,
          rowCount: p.rows.length,
          insertedCount: inserted,
          duplicateCount: p.rows.length - inserted,
          errorCount: p.errors.length,
          balanceCheck: p.balance.status,
        },
        select: { id: true },
      });

      // Link every row (new or already known) to this import.
      const ids = new Map(
        (await tx.transaction.findMany({ where: { accountId, fingerprint: { in: fingerprints } }, select: { id: true, fingerprint: true } })).map(
          (t) => [t.fingerprint, t.id],
        ),
      );
      await tx.transactionSourceLink.createMany({
        data: p.rows.map((r) => ({
          transactionId: ids.get(r.fingerprint)!,
          importBatchId: batch.id,
          source: p.source,
          sourceLine: r.line,
          created: !before.has(r.fingerprint),
          matchedBy: absorbed.has(r.fingerprint) ? "EXACT" : null,
        })),
        skipDuplicates: true,
      });

      if (jobId) {
        // Done: link the batch and drop the stored rows.
        await tx.importJob.update({
          where: { id: jobId },
          data: { status: "COMMITTED", importBatchId: batch.id, result: Prisma.DbNull },
        });
      }

      await writeAudit(
        tx,
        {
          userId,
          action: "import.commit",
          entityType: "import_batch",
          entityId: batch.id,
          metadata: {
            source: p.source,
            via: jobId ? "worker" : "direct",
            rows: p.rows.length,
            inserted,
            duplicates: p.rows.length - inserted,
            errors: p.errors.length,
            balanceCheck: p.balance.status,
            fileSha256: p.fileSha256,
          },
        },
        headers,
      );

      return { inserted, duplicates: p.rows.length - inserted, errors: p.errors.length, batchId: batch.id };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  if (!result) return { ok: false as const, error: "This import was already confirmed or has expired." };
  return { ok: true as const, ...result };
}

// ── Direct path: the file comes with the request (password-locked PDFs) ──

type DirectParse = Failure | { ok: true; parsed: Parsed; accountId: string; fileName: string };

async function directParse(userId: string, accountId: unknown, file: unknown, pdfPassword: unknown): Promise<DirectParse> {
  const account = await ownedImportAccount(userId, accountId);
  if (!account) return { ok: false, error: "Account not found." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV or PDF file." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "File is larger than 1 MB. Export a shorter period." };
  const password = typeof pdfPassword === "string" && pdfPassword ? pdfPassword : undefined;
  const parsed = await parseFile(new Uint8Array(await file.arrayBuffer()), file.name, account.id, isoDateIST(), password);
  if (!parsed.ok) return parsed;
  return { ok: true, parsed, accountId: account.id, fileName: file.name.slice(0, 200) };
}

/**
 * Commit rows that didn't come from an uploaded file (Account Aggregator):
 * the exact same idempotent insert, source links, alert reconciliation and
 * audit as statement imports. Caller has already authorised the account.
 */
export function commitAggregatorRows(userId: string, accountId: string, label: string, p: Omit<CommitInput, "source" | "ok">, headers: Headers) {
  return commitRows(userId, accountId, label, { ...p, ok: true, source: "AA" }, headers);
}

export async function previewImport(userId: string, accountId: unknown, file: unknown, pdfPassword: unknown) {
  const r = await directParse(userId, accountId, file, pdfPassword);
  if (!r.ok) return r;
  return { ok: true as const, preview: await buildPreview(r.accountId, r.fileName, r.parsed) };
}

export async function commitImport(userId: string, accountId: unknown, file: unknown, pdfPassword: unknown, headers: Headers) {
  const r = await directParse(userId, accountId, file, pdfPassword);
  if (!r.ok) return r;
  return commitRows(userId, r.accountId, r.fileName, r.parsed, headers);
}

// ── Job path: browser uploads to Cloud Storage, the worker parses ──

export async function startUploadJob(userId: string, accountId: unknown, fileName: unknown, size: unknown) {
  const account = await ownedImportAccount(userId, accountId);
  if (!account) return { ok: false as const, error: "Account not found." };
  if (typeof fileName !== "string" || !fileName || fileName.length > 200) return { ok: false as const, error: "Invalid file name." };
  const kind = kindFromName(fileName);
  if (!kind) return { ok: false as const, error: "Only .csv and .pdf statements are supported." };
  if (typeof size !== "number" || size <= 0 || size > MAX_FILE_BYTES) {
    return { ok: false as const, error: "File is larger than 1 MB. Export a shorter period." };
  }

  // Limit concurrent pending uploads per user (each holds a signed URL).
  const pending = await db.importJob.count({
    where: { userId, status: { in: ["AWAITING_UPLOAD", "PARSING"] }, expiresAt: { gt: new Date() } },
  });
  if (pending >= 5) return { ok: false as const, error: "Too many imports in progress. Wait a moment and try again." };

  const jobId = randomUUID();
  // The path, not the client, tells the worker who owns the file.
  const objectPath = `uploads/${userId}/${jobId}`;
  const contentType = kind === "PDF" ? "application/pdf" : "text/csv";
  await db.importJob.create({
    data: {
      id: jobId,
      userId,
      accountId: account.id,
      fileName,
      objectPath,
      source: kind,
      expiresAt: new Date(Date.now() + JOB_TTL_MS),
    },
  });
  const upload = await signedUploadUrl(objectPath, contentType, MAX_FILE_BYTES);
  return { ok: true as const, jobId, ...upload };
}

export type JobView =
  | { status: "AWAITING_UPLOAD" | "PARSING" }
  | { status: "READY"; preview: ImportPreview }
  | { status: "FAILED"; error: string; needsPassword: boolean }
  | { status: "COMMITTED" | "EXPIRED" | "NOT_FOUND" };

export async function getJobView(userId: string, jobId: unknown): Promise<JobView> {
  if (typeof jobId !== "string" || !UUID_RE.test(jobId)) return { status: "NOT_FOUND" };
  const job = await db.importJob.findFirst({
    where: { id: jobId, userId }, // never another user's job
    select: { status: true, error: true, result: true, source: true, accountId: true, fileName: true, expiresAt: true },
  });
  if (!job) return { status: "NOT_FOUND" };
  if (job.status === "COMMITTED") return { status: "COMMITTED" };
  if (job.expiresAt < new Date()) return { status: "EXPIRED" };
  if (job.status === "FAILED") {
    const needsPassword = (job.result as { needsPassword?: boolean } | null)?.needsPassword === true;
    return { status: "FAILED", error: job.error ?? "Import failed.", needsPassword };
  }
  if (job.status === "READY" && job.result) {
    const parsed = fromStored(job.result as StoredResult, job.source as "CSV" | "PDF");
    return { status: "READY", preview: await buildPreview(job.accountId, job.fileName, parsed) };
  }
  return { status: job.status === "READY" ? "PARSING" : job.status };
}

export async function commitJob(userId: string, jobId: unknown, headers: Headers) {
  if (typeof jobId !== "string" || !UUID_RE.test(jobId)) return { ok: false as const, error: "Import not found." };
  const job = await db.importJob.findFirst({
    where: { id: jobId, userId, status: "READY", expiresAt: { gt: new Date() } },
    select: { accountId: true, fileName: true, result: true, source: true },
  });
  if (!job?.result) return { ok: false as const, error: "This import was already confirmed or has expired." };
  const parsed = fromStored(job.result as StoredResult, job.source as "CSV" | "PDF");
  return commitRows(userId, job.accountId, job.fileName, parsed, headers, jobId);
}

// ── History ──

export async function recentImports(userId: string) {
  const rows = await db.importBatch.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      fileName: true,
      source: true,
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
    source: b.source,
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
