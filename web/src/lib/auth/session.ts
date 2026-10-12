import "server-only";

import { io } from "next/cache";
import { cookies, headers } from "next/headers";
import { cache } from "react";

import { db } from "@/lib/db";
import { adminAuth } from "@/lib/firebase/admin";

import { SESSION_COOKIE } from "./constants";

export { SESSION_COOKIE };

export const SESSION_MAX_AGE_SEC = 5 * 24 * 60 * 60; // 5 days

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true, // JavaScript can't read it, so XSS can't steal it
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const, // not sent on cross-site POSTs
    path: "/",
    maxAge,
  };
}

export type SessionUser = {
  id: string;
  email: string;
  displayName: string | null;
};

// Data Access Layer: the ONE place that decides who the caller is.
// - Web: httpOnly session cookie (Firebase session cookie).
// - Mobile (later): `Authorization: Bearer <Firebase ID token>`.
// checkRevoked=true means a logout / "sign out everywhere" takes effect
// immediately instead of when the token expires. Costs one extra call to
// Firebase; worth it for a finance app.
// React `cache` de-duplicates this within one request.
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const decoded = await verifyCaller();
  if (!decoded) return null;

  const user = await db.user.findUnique({
    where: { firebaseUid: decoded.uid },
    select: { id: true, email: true, displayName: true },
  });
  return user;
});

async function verifyCaller() {
  // Token verification compares expiry with the current time, so it must run
  // per request, never in a prerender/prefetch. (We deliberately don't use
  // "use cache: private": a revoked session could stay valid for minutes.)
  // Outside the try: during prerender io() suspends, and catching that would
  // wrongly look like "signed out".
  await io();

  try {
    const authz = (await headers()).get("authorization");
    if (authz?.startsWith("Bearer ")) {
      return await adminAuth.verifyIdToken(authz.slice(7), true);
    }

    const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
    if (cookie) {
      return await adminAuth.verifySessionCookie(cookie, true);
    }
  } catch {
    // Expired, revoked or forged: treat as signed out.
  }
  return null;
}
