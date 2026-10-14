"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { AA_HANDLES, requestConsent, revokeAaConsent, syncConsent, type SyncView } from "@/lib/aa/service";
import { getSessionUser } from "@/lib/auth/session";
import { checkBudgetsQuietly } from "@/lib/budgets/service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

const SESSION_EXPIRED = "Your session has expired. Please sign in again.";

export async function startConsent(mobile: string, handle: string, agreed: boolean): Promise<{ ok: true; approveUrl: string } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: SESSION_EXPIRED };
  if (agreed !== true) return { ok: false, error: "Please read and accept what will be shared." };
  const h = await headers();
  if (!rateLimit(`aa-consent:${user.id}:${clientIp(h)}`, 5, 60 * 60_000).ok) return { ok: false, error: "Too many consent requests. Try again later." };
  const aa = z.enum(AA_HANDLES).catch("setu").parse(handle);
  const r = await requestConsent(user.id, z.string().max(20).catch("").parse(mobile), aa, h);
  return r.ok ? { ok: true, approveUrl: r.approveUrl } : r;
}

export async function pollConsent(consentId: string): Promise<SyncView> {
  const user = await getSessionUser();
  if (!user) return { status: "REJECTED", phase: "failed", message: SESSION_EXPIRED };
  if (!z.uuid().safeParse(consentId).success) return { status: "REJECTED", phase: "failed", message: "Consent not found." };
  const h = await headers();
  if (!rateLimit(`aa-poll:${user.id}:${clientIp(h)}`, 60, 60_000).ok) return { status: "PENDING", phase: "fetching", message: "Checking…" };
  const view = await syncConsent(user.id, consentId, h);
  if (view.phase === "imported" && view.summary?.inserted) await checkBudgetsQuietly(user.id);
  return view;
}

export async function revoke(consentId: string, deleteData: boolean): Promise<{ ok: boolean; message: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: SESSION_EXPIRED };
  if (!z.uuid().safeParse(consentId).success) return { ok: false, message: "Consent not found." };
  const r = await revokeAaConsent(user.id, consentId, deleteData === true, await headers());
  if (r.ok) refresh();
  return r.ok
    ? { ok: true, message: deleteData ? `Consent revoked. ${r.deleted} transaction${r.deleted === 1 ? "" : "s"} fetched under it deleted.` : "Consent revoked." }
    : { ok: false, message: r.error };
}
