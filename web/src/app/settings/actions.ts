"use server";

import { cookies, headers } from "next/headers";

import { SESSION_COOKIE, getRecentlyAuthenticatedUser, sessionCookieOptions } from "@/lib/auth/session";
import { deleteUserAndData } from "@/lib/privacy/service";

const STEP_UP_SECONDS = 10 * 60;

export type DeleteResult = { ok: true } | { ok: false; error: string; reauth?: boolean };

export async function deleteMyAccount(confirmation: string): Promise<DeleteResult> {
  if (confirmation !== "DELETE") return { ok: false, error: 'Type DELETE (in capitals) to confirm.' };

  const check = await getRecentlyAuthenticatedUser(STEP_UP_SECONDS);
  if (!check.ok) {
    return check.reason === "reauth"
      ? { ok: false, reauth: true, error: "For your security, sign in again (within the last 10 minutes) before deleting your account." }
      : { ok: false, error: "Your session has expired. Please sign in again." };
  }

  await deleteUserAndData(check.user.id, check.firebaseUid, await headers());
  (await cookies()).set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return { ok: true };
}
