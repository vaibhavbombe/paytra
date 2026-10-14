"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { parseBankAlert } from "@/lib/alerts/parse";
import { accountsForAlert, confirmMatch, ingestAlert, type IngestResult } from "@/lib/alerts/service";
import { getSessionUser } from "@/lib/auth/session";
import { checkBudgetsQuietly } from "@/lib/budgets/service";
import { formatPaise } from "@/lib/money";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

const SESSION_EXPIRED = "Your session has expired. Please sign in again.";
const AlertText = z.string().trim().min(10, "Paste the full alert text.").max(2000, "That's too long for a bank alert.");

export type AlertPreview =
  | { ok: false; error: string }
  | {
      ok: true;
      direction: "DEBIT" | "CREDIT";
      amount: string;
      date: string | null;
      payee: string | null;
      reference: string | null;
      bank: string | null;
      accountLast: string | null;
      suggestedAccountId: string | null;
    };

/** Parse only: shows what PayTra understood before anything is saved. The pasted text itself is never stored. */
export async function previewAlert(text: string): Promise<AlertPreview> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: SESSION_EXPIRED };
  const parsedText = AlertText.safeParse(text);
  if (!parsedText.success) return { ok: false, error: parsedText.error.issues[0].message };
  const a = parseBankAlert(parsedText.data);
  if (!a) return { ok: false, error: "That doesn't look like a bank transaction alert (OTPs and offers are ignored)." };
  const { suggested } = await accountsForAlert(user.id, a.accountLast);
  return {
    ok: true,
    direction: a.direction,
    amount: formatPaise(a.amountPaise),
    date: a.txnDate,
    payee: a.payee,
    reference: a.reference,
    bank: a.bank,
    accountLast: a.accountLast,
    suggestedAccountId: suggested,
  };
}

export async function saveAlert(text: string, accountId: string): Promise<IngestResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: SESSION_EXPIRED };
  const h = await headers();
  if (!rateLimit(`alert:${user.id}:${clientIp(h)}`, 30, 60_000).ok) return { ok: false, error: "Too many alerts. Try again in a minute." };
  const parsedText = AlertText.safeParse(text);
  if (!parsedText.success || !z.uuid().safeParse(accountId).success) return { ok: false, error: "Invalid request." };
  // Re-parsed on the server: nothing from the preview is trusted.
  const a = parseBankAlert(parsedText.data);
  if (!a) return { ok: false, error: "That doesn't look like a bank transaction alert." };
  const result = await ingestAlert(user.id, accountId, a, "EMAIL", h);
  if (result.ok && result.status !== "duplicate") {
    await checkBudgetsQuietly(user.id);
    refresh();
  }
  return result;
}

export async function acceptMatch(alertTxnId: string, bookTxnId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: SESSION_EXPIRED };
  if (!z.uuid().safeParse(alertTxnId).success || !z.uuid().safeParse(bookTxnId).success) return { ok: false, error: "Invalid request." };
  const r = await confirmMatch(user.id, alertTxnId, bookTxnId, await headers());
  if (r.ok) {
    await checkBudgetsQuietly(user.id); // the duplicate's amount no longer counts twice
    refresh();
  }
  return r;
}
