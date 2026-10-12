import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { clientIp } from "./security/rate-limit";

type AuditEntry = {
  userId: string | null;
  action: string; // e.g. "auth.login"
  entityType?: string;
  entityId?: string;
  // Changed fields / context only. Never tokens, passwords or raw narrations.
  metadata?: Prisma.InputJsonValue;
};

// Takes a transaction client so the audit row commits (or rolls back)
// together with the change it describes.
export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
  headers?: Headers,
) {
  await tx.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
      ip: headers ? clientIp(headers) : null,
      userAgent: headers?.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
}
