"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { getSessionUser } from "@/lib/auth/session";
import { commitImport as commit, previewImport as preview, type ImportPreview } from "@/lib/imports/service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

export type PreviewState = { ok: true; preview: ImportPreview } | { ok: false; error: string };
export type CommitState =
  | { ok: true; inserted: number; duplicates: number; errors: number }
  | { ok: false; error: string };

// Parsing is CPU work on our server: cap it per user and IP.
async function allowed(userId: string) {
  const h = await headers();
  return rateLimit(`import:${userId}:${clientIp(h)}`, 20, 60_000).ok;
}

export async function previewImport(formData: FormData): Promise<PreviewState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  if (!(await allowed(user.id))) return { ok: false, error: "Too many uploads. Try again in a minute." };
  return preview(user.id, formData.get("accountId"), formData.get("file"));
}

export async function commitImport(formData: FormData): Promise<CommitState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  if (!(await allowed(user.id))) return { ok: false, error: "Too many uploads. Try again in a minute." };
  const result = await commit(user.id, formData.get("accountId"), formData.get("file"), await headers());
  if (result.ok) refresh();
  return result.ok ? { ok: true, inserted: result.inserted, duplicates: result.duplicates, errors: result.errors } : result;
}
