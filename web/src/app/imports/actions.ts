"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { getSessionUser } from "@/lib/auth/session";
import {
  commitImport as commitDirect,
  commitJob,
  getJobView,
  previewImport as previewDirect,
  startUploadJob,
  type ImportPreview,
  type JobView,
} from "@/lib/imports/service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

export type PreviewState = { ok: true; preview: ImportPreview } | { ok: false; error: string; needsPassword?: boolean };
export type CommitState =
  | { ok: true; inserted: number; duplicates: number; errors: number }
  | { ok: false; error: string; needsPassword?: boolean };
export type StartUploadState =
  | { ok: true; jobId: string; url: string; headers: Record<string, string> }
  | { ok: false; error: string };

const SESSION_EXPIRED = "Your session has expired. Please sign in again.";

// Parsing is CPU work: cap it per user and IP. Also slows down anyone trying
// to guess a PDF's password on the direct path.
async function allowed(userId: string, bucket = "import", limit = 20) {
  const h = await headers();
  return rateLimit(`${bucket}:${userId}:${clientIp(h)}`, limit, 60_000).ok;
}

// ── Background path (default): signed upload -> worker -> poll ──

export async function startUpload(input: { accountId: string; fileName: string; size: number }): Promise<StartUploadState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: SESSION_EXPIRED };
  if (!(await allowed(user.id))) return { ok: false, error: "Too many uploads. Try again in a minute." };
  return startUploadJob(user.id, input?.accountId, input?.fileName, input?.size);
}

export async function jobStatus(jobId: string): Promise<JobView> {
  const user = await getSessionUser();
  if (!user) return { status: "NOT_FOUND" };
  // Polling: generous limit, still bounded.
  if (!(await allowed(user.id, "poll", 120))) return { status: "PARSING" };
  return getJobView(user.id, jobId);
}

export async function confirmJob(jobId: string): Promise<CommitState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: SESSION_EXPIRED };
  const result = await commitJob(user.id, jobId, await headers());
  if (result.ok) refresh();
  return result.ok ? { ok: true, inserted: result.inserted, duplicates: result.duplicates, errors: result.errors } : result;
}

// ── Direct path: only for password-protected PDFs, so the password exists
//    only inside this one request and never in a queue or database. ──

export async function previewImport(formData: FormData): Promise<PreviewState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: SESSION_EXPIRED };
  if (!(await allowed(user.id))) return { ok: false, error: "Too many uploads. Try again in a minute." };
  return previewDirect(user.id, formData.get("accountId"), formData.get("file"), formData.get("pdfPassword"));
}

export async function commitImport(formData: FormData): Promise<CommitState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: SESSION_EXPIRED };
  if (!(await allowed(user.id))) return { ok: false, error: "Too many uploads. Try again in a minute." };
  const result = await commitDirect(user.id, formData.get("accountId"), formData.get("file"), formData.get("pdfPassword"), await headers());
  if (result.ok) refresh();
  return result.ok ? { ok: true, inserted: result.inserted, duplicates: result.duplicates, errors: result.errors } : result;
}
