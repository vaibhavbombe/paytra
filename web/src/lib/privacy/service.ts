import "server-only";

import { writeAudit } from "@/lib/audit";
import { dbDateToIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { adminAuth } from "@/lib/firebase/admin";

// ── Activity log (the user's own audit trail) ──

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.logout": "Signed out (all devices)",
  "transaction.create": "Added a transaction",
  "transaction.category": "Changed a category",
  "category.recategorise": "Auto-categorised transactions",
  "category.ai_suggest": "Asked AI to suggest categories",
  "insights.ask": "Asked a question about spending",
  "rule.delete": "Deleted a category rule",
  "import.commit": "Imported a statement",
  "account.create": "Added an account",
  "budget.create": "Created a budget",
  "budget.delete": "Deleted a budget",
  "push.enable": "Turned on push alerts",
  "push.disable": "Turned off push alerts",
  "data.export": "Downloaded your data",
  "alert.create": "Added a bank alert",
  "alert.merge": "Bank alert matched to statement",
  "reconcile.confirm": "Confirmed a reconciliation match",
};

/** 203.0.113.42 -> 203.0.113.x ; 2001:db8:1:2::5 -> 2001:db8:1::/48. Enough to recognise, not to track. */
export function maskIp(ip: string | null): string {
  if (!ip || ip === "unknown") return "—";
  const v4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.x`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}::/48`;
  return "—";
}

/** "Chrome on Windows" from a user agent: a label, never a fingerprint. */
export function deviceFromUserAgent(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "device";
  return `${browser} on ${os}`;
}

export async function recentActivity(userId: string, limit = 50) {
  const rows = await db.auditLog.findMany({
    where: { userId },
    orderBy: { id: "desc" },
    take: limit,
    select: { id: true, action: true, createdAt: true, ip: true, userAgent: true, metadata: true },
  });
  return rows.map((r) => ({
    id: r.id.toString(),
    action: ACTION_LABELS[r.action] ?? r.action,
    at: r.createdAt,
    ip: maskIp(r.ip),
    device: deviceFromUserAgent(r.userAgent),
    // Only small, non-sensitive facts from metadata.
    detail:
      r.action === "import.commit" && r.metadata && typeof r.metadata === "object" && "inserted" in r.metadata
        ? `${(r.metadata as { inserted: number }).inserted} new`
        : r.action === "auth.login" && r.metadata && typeof r.metadata === "object" && "provider" in r.metadata
          ? String((r.metadata as { provider: string }).provider).replace(".com", "")
          : "",
  }));
}

// ── Export ──

const big = (v: bigint | null) => (v === null ? null : v.toString());

/**
 * Everything we hold about the user, as plain JSON. Account numbers stay
 * masked (last 4 only); encrypted fields and internal dedupe hashes are not
 * included because they aren't readable personal data.
 */
export async function exportUserData(userId: string) {
  const [user, accounts, transactions, categories, rules, budgets, alerts, imports, consents, audit] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, displayName: true, createdAt: true } }),
    db.account.findMany({ where: { userId }, select: { id: true, institutionName: true, nickname: true, type: true, last4: true, currency: true, createdAt: true } }),
    db.transaction.findMany({
      where: { userId },
      orderBy: { txnDate: "asc" },
      select: {
        id: true,
        accountId: true,
        direction: true,
        amountPaise: true,
        currency: true,
        txnDate: true,
        description: true,
        merchant: true,
        reference: true,
        notes: true,
        source: true,
        categorySource: true,
        category: { select: { name: true } },
        createdAt: true,
      },
    }),
    db.category.findMany({ where: { userId }, select: { name: true, kind: true } }),
    db.categoryRule.findMany({ where: { userId }, select: { pattern: true, matchType: true, direction: true, category: { select: { name: true } } } }),
    db.budget.findMany({ where: { userId }, select: { period: true, limitPaise: true, alertAtPercents: true, active: true, category: { select: { name: true } } } }),
    db.budgetAlert.findMany({ where: { userId }, select: { periodStart: true, thresholdPercent: true, spentPaise: true, limitPaise: true, createdAt: true } }),
    db.importBatch.findMany({ where: { userId }, select: { fileName: true, source: true, rowCount: true, insertedCount: true, duplicateCount: true, errorCount: true, balanceCheck: true, createdAt: true } }),
    db.consent.findMany({ where: { userId }, select: { purpose: true, status: true, dataFrom: true, dataTo: true, grantedAt: true, revokedAt: true } }),
    db.auditLog.findMany({ where: { userId }, orderBy: { id: "asc" }, select: { action: true, createdAt: true } }),
  ]);

  return {
    format: "paytra-export-v1",
    note: "Amounts are in paise (1 rupee = 100 paise). Account numbers are masked to the last 4 digits.",
    user,
    accounts,
    transactions: transactions.map(({ amountPaise, txnDate, category, ...t }) => ({
      ...t,
      amountPaise: big(amountPaise),
      txnDate: dbDateToIso(txnDate),
      category: category?.name ?? null,
    })),
    categories,
    categoryRules: rules.map(({ category, ...r }) => ({ ...r, category: category.name })),
    budgets: budgets.map(({ limitPaise, category, ...b }) => ({ ...b, limitPaise: big(limitPaise), category: category?.name ?? "Overall" })),
    budgetAlerts: alerts.map(({ spentPaise, limitPaise, periodStart, ...a }) => ({
      ...a,
      periodStart: dbDateToIso(periodStart),
      spentPaise: big(spentPaise),
      limitPaise: big(limitPaise),
    })),
    imports,
    consents,
    activity: audit,
  };
}

// ── Delete ──

/**
 * Permanently delete the user: every row they own (ON DELETE CASCADE), then
 * their Firebase login. The audit trail keeps its rows with user_id set to
 * NULL (allowed by the append-only trigger), so "an account was deleted at
 * T" survives without any personal data.
 */
export async function deleteUserAndData(userId: string, firebaseUid: string, headers: Headers) {
  await db.$transaction(async (tx) => {
    await writeAudit(tx, { userId, action: "account.delete" }, headers);
    await tx.user.delete({ where: { id: userId } });
  });
  // After the data is gone. If this fails the person can't use the old data
  // anyway (it no longer exists); a later sign-in just starts a new, empty account.
  try {
    await adminAuth.deleteUser(firebaseUid);
  } catch (e) {
    console.error(JSON.stringify({ severity: "ERROR", message: "firebase deleteUser failed", error: String(e) }));
  }
}
