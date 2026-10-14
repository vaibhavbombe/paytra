import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { writeAudit } from "@/lib/audit";
import { isoDateIST } from "@/lib/dates";
import { db } from "@/lib/db";
import { commitAggregatorRows } from "@/lib/imports/service";
import { Prisma } from "@/generated/prisma/client";

import { fipDisplayName, last4FromMasked, parseAaAccount } from "./map";
import { createConsent, createDataSession, getConsent, getDataSession, revokeConsent, SetuError, type AaTransaction } from "./setu";

// Account Aggregator flow (Setu SANDBOX, mock data):
//   request consent -> user approves on Setu's screen -> data session ->
//   data ready -> import through the statement pipeline.
// Safe to call repeatedly (browser polling and Setu's webhook may overlap):
// each step is checked against the stored state, and the import is claimed
// atomically so it runs once.

const MONTHS_OF_DATA = 12;
const MAX_PENDING = 3;

type Details = {
  purposeCode: "102";
  fiTypes: ["DEPOSIT"];
  consentTypes: ["TRANSACTIONS", "SUMMARY"];
  fetchType: "ONETIME";
  dataLifeMonths: 1;
  sessionId?: string;
  importing?: boolean;
  importedAt?: string;
  importBatchIds?: string[];
  summary?: { accounts: number; inserted: number; duplicates: number; errors: number };
  error?: string;
};

const asDetails = (v: Prisma.JsonValue | null): Details => (v && typeof v === "object" ? (v as unknown as Details) : ({} as Details));

/** Indian mobile number (10 digits starting 6-9), used as the AA "VUA". */
export function normaliseMobile(input: string): string | null {
  const digits = input.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export async function requestConsent(userId: string, mobile: string, headers: Headers) {
  const vua = normaliseMobile(mobile);
  if (!vua) return { ok: false as const, error: "Enter a 10-digit Indian mobile number." };

  const pending = await db.consent.count({ where: { userId, purpose: "AA_FETCH", status: "PENDING" } });
  if (pending >= MAX_PENDING) return { ok: false as const, error: "You already have consent requests waiting. Approve or let them expire first." };

  const to = new Date();
  const from = new Date(to);
  from.setUTCMonth(from.getUTCMonth() - MONTHS_OF_DATA);
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";

  // Our id goes into the return URL, so the return page knows which consent
  // to check. It's only a lookup key: the page verifies ownership and reads
  // the real status from Setu.
  const rowId = randomUUID();
  let created;
  try {
    created = await createConsent({ vua, from, to, redirectUrl: `${origin}/aa/return?consent=${rowId}` });
  } catch (e) {
    return { ok: false as const, error: e instanceof SetuError ? e.message : "Couldn't create the consent request." };
  }

  const details: Details = { purposeCode: "102", fiTypes: ["DEPOSIT"], consentTypes: ["TRANSACTIONS", "SUMMARY"], fetchType: "ONETIME", dataLifeMonths: 1 };
  const row = await db.$transaction(async (tx) => {
    const c = await tx.consent.create({
      data: {
        id: rowId,
        userId,
        purpose: "AA_FETCH",
        status: "PENDING",
        dataFrom: new Date(`${isoDateIST(from)}T00:00:00Z`),
        dataTo: new Date(`${isoDateIST(to)}T00:00:00Z`),
        externalRef: created.id, // Setu consent handle, never a credential
        details: details as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 31 * 86_400_000),
      },
      select: { id: true },
    });
    await writeAudit(tx, { userId, action: "consent.request", entityType: "consent", entityId: c.id, metadata: { purpose: "AA_FETCH", purposeCode: "102" } }, headers);
    return c;
  });
  return { ok: true as const, consentId: row.id, approveUrl: created.url };
}

const STATUS: Record<string, "PENDING" | "ACTIVE" | "REVOKED" | "EXPIRED" | "REJECTED"> = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  APPROVED: "ACTIVE",
  PAUSED: "PENDING",
  REJECTED: "REJECTED",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
};

export type SyncView = {
  status: "PENDING" | "ACTIVE" | "REVOKED" | "EXPIRED" | "REJECTED";
  phase: "awaiting-approval" | "fetching" | "imported" | "failed" | "closed";
  message: string;
  summary?: Details["summary"];
};

/** One step forward, based on the stored state. Called by the return page (polling) and by the webhook. */
export async function syncConsent(userId: string, consentRowId: string, headers: Headers): Promise<SyncView> {
  const row = await db.consent.findFirst({
    where: { id: consentRowId, userId, purpose: "AA_FETCH" },
    select: { id: true, status: true, externalRef: true, dataFrom: true, dataTo: true, details: true },
  });
  if (!row?.externalRef) return { status: "REJECTED", phase: "failed", message: "Consent not found." };
  let details = asDetails(row.details);

  if (details.importedAt) return { status: row.status as SyncView["status"], phase: "imported", message: "Transactions imported.", summary: details.summary };
  if (row.status === "REVOKED" || row.status === "REJECTED" || row.status === "EXPIRED") {
    return { status: row.status, phase: "closed", message: row.status === "REJECTED" ? "You declined the request at the Account Aggregator." : `This consent is ${row.status.toLowerCase()}.` };
  }

  // 1. Consent status straight from Setu (never from a webhook payload).
  let remote;
  try {
    remote = await getConsent(row.externalRef);
  } catch (e) {
    return { status: row.status as SyncView["status"], phase: "failed", message: e instanceof SetuError ? e.message : "Couldn't reach the Account Aggregator." };
  }
  const status = STATUS[remote.status.toUpperCase()] ?? "PENDING";
  if (status !== row.status) {
    await db.$transaction(async (tx) => {
      await tx.consent.update({ where: { id: row.id }, data: { status, ...(status === "ACTIVE" && { grantedAt: new Date() }) } });
      await writeAudit(tx, { userId, action: `consent.${status.toLowerCase()}`, entityType: "consent", entityId: row.id }, headers);
    });
  }
  if (status === "PENDING") return { status, phase: "awaiting-approval", message: "Waiting for you to approve at the Account Aggregator." };
  if (status !== "ACTIVE") return { status, phase: "closed", message: status === "REJECTED" ? "You declined the request at the Account Aggregator." : `This consent is ${status.toLowerCase()}.` };

  // 2. Start a data session for exactly the consented period.
  if (!details.sessionId) {
    try {
      const session = await createDataSession(row.externalRef, row.dataFrom!, new Date(Math.min(Date.now(), row.dataTo!.getTime() + 86_399_000)));
      details = { ...details, sessionId: session.id };
      await db.consent.update({ where: { id: row.id }, data: { details: details as unknown as Prisma.InputJsonValue } });
    } catch (e) {
      return { status, phase: "failed", message: e instanceof SetuError ? e.message : "Couldn't start fetching your data." };
    }
  }

  // 3. Is the data ready?
  let session;
  try {
    session = await getDataSession(details.sessionId!);
  } catch (e) {
    return { status, phase: "failed", message: e instanceof SetuError ? e.message : "Couldn't check the data request." };
  }
  const sStatus = session.status.toUpperCase();
  if (sStatus === "FAILED" || sStatus === "EXPIRED") return { status, phase: "failed", message: `The bank data request ${sStatus.toLowerCase()}. Start a new consent.` };
  if (sStatus !== "COMPLETED" && sStatus !== "PARTIAL") return { status, phase: "fetching", message: "Your bank is preparing the data…" };

  // 4. Import, claimed atomically so a parallel poll/webhook can't import twice.
  const claimed = await db.$executeRaw`
    UPDATE consents SET details = details || '{"importing": true}'::jsonb, updated_at = now()
    WHERE id = ${row.id}::uuid AND NOT (details ? 'importing') AND NOT (details ? 'importedAt')`;
  if (claimed === 0) return { status, phase: "fetching", message: "Importing…" };

  try {
    const summary = { accounts: 0, inserted: 0, duplicates: 0, errors: 0 };
    const batchIds: string[] = [];
    for (const fip of session.fips ?? []) {
      for (const acc of fip.accounts ?? []) {
        const raw = acc.data?.account?.transactions?.transaction;
        const txns: AaTransaction[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
        if (txns.length === 0) continue;
        const accountId = await accountFor(userId, fip.fipID ?? null, acc.maskedAccNumber ?? acc.data?.account?.maskedAccNumber ?? null);
        const parsed = parseAaAccount(txns, accountId, isoDateIST());
        if (!parsed.ok || parsed.rows.length === 0) {
          summary.errors += txns.length;
          continue;
        }
        const fingerprintOfData = createHash("sha256").update(parsed.rows.map((r) => r.fingerprint).join("|")).digest("hex");
        const result = await commitAggregatorRows(
          userId,
          accountId,
          `Account Aggregator · ${fipDisplayName(fip.fipID)} ${acc.maskedAccNumber ?? ""}`.trim().slice(0, 200),
          { fileSha256: fingerprintOfData, rows: parsed.rows, errors: parsed.errors, balance: parsed.balance, period: parsed.period },
          headers,
        );
        if (result.ok) {
          summary.accounts += 1;
          summary.inserted += result.inserted;
          summary.duplicates += result.duplicates;
          summary.errors += result.errors;
          batchIds.push(result.batchId);
        }
      }
    }
    details = { ...details, importing: undefined, importedAt: new Date().toISOString(), importBatchIds: batchIds, summary };
    await db.$transaction(async (tx) => {
      await tx.consent.update({ where: { id: row.id }, data: { details: JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue } });
      await writeAudit(tx, { userId, action: "consent.import", entityType: "consent", entityId: row.id, metadata: summary }, headers);
    });
    return { status, phase: "imported", message: "Transactions imported.", summary };
  } catch (e) {
    // Release the claim so a later poll can retry.
    await db.$executeRaw`UPDATE consents SET details = details - 'importing' WHERE id = ${row.id}::uuid`;
    throw e;
  }
}

/** Match an AA account to the user's account by last 4 digits, or create it. */
async function accountFor(userId: string, fipId: string | null, masked: string | null): Promise<string> {
  const last4 = last4FromMasked(masked);
  if (last4) {
    const existing = await db.account.findFirst({ where: { userId, last4, type: { not: "CASH" } }, select: { id: true } });
    if (existing) return existing.id;
  }
  const created = await db.account.create({
    data: { userId, institutionName: fipDisplayName(fipId), nickname: null, type: "SAVINGS", last4 },
    select: { id: true },
  });
  return created.id;
}

/**
 * Revoke at the Account Aggregator, and optionally delete what was fetched
 * under this consent (transactions this consent created that no other source
 * also reported).
 */
export async function revokeAaConsent(userId: string, consentRowId: string, deleteData: boolean, headers: Headers) {
  const row = await db.consent.findFirst({ where: { id: consentRowId, userId, purpose: "AA_FETCH" }, select: { id: true, status: true, externalRef: true, details: true } });
  if (!row) return { ok: false as const, error: "Consent not found." };

  if (row.externalRef && (row.status === "ACTIVE" || row.status === "PENDING")) {
    try {
      await revokeConsent(row.externalRef);
    } catch (e) {
      // Already revoked/expired at the AA is fine; anything else is a real failure.
      if (!(e instanceof SetuError) || e.status >= 500) return { ok: false as const, error: "Couldn't reach the Account Aggregator to revoke. Try again." };
    }
  }

  const batchIds = asDetails(row.details).importBatchIds ?? [];
  const deleted = await db.$transaction(async (tx) => {
    await tx.consent.update({ where: { id: row.id }, data: { status: "REVOKED", revokedAt: new Date() } });
    let count = 0;
    if (deleteData && batchIds.length) {
      const created = await tx.transactionSourceLink.findMany({
        where: { importBatchId: { in: batchIds }, created: true },
        select: { transactionId: true },
      });
      const ids = created.map((c) => c.transactionId);
      // Keep any transaction another source also reported (statement, alert, manual).
      const shared = new Set(
        (await tx.transactionSourceLink.findMany({ where: { transactionId: { in: ids }, OR: [{ importBatchId: null }, { importBatchId: { notIn: batchIds } }] }, select: { transactionId: true } })).map((l) => l.transactionId),
      );
      const toDelete = ids.filter((id) => !shared.has(id));
      count = (await tx.transaction.deleteMany({ where: { id: { in: toDelete }, userId } })).count;
      await tx.importBatch.deleteMany({ where: { id: { in: batchIds }, userId } });
    }
    await writeAudit(tx, { userId, action: "consent.revoke", entityType: "consent", entityId: row.id, metadata: { deletedTransactions: count } }, headers);
    return count;
  });
  return { ok: true as const, deleted };
}

export async function listAaConsents(userId: string) {
  const rows = await db.consent.findMany({
    where: { userId, purpose: "AA_FETCH" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, status: true, dataFrom: true, dataTo: true, createdAt: true, grantedAt: true, revokedAt: true, expiresAt: true, details: true },
  });
  return rows.map((r) => ({ ...r, details: asDetails(r.details) }));
}

/** Webhook: find our consent by Setu's id. The payload is only a hint; syncConsent re-reads everything from Setu. */
export async function consentOwner(setuConsentId: string) {
  return db.consent.findFirst({ where: { externalRef: setuConsentId, purpose: "AA_FETCH" }, select: { id: true, userId: true } });
}
