import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureCashAccount } from "@/lib/accounts";
import { writeAudit } from "@/lib/audit";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { db } from "@/lib/db";
import { removeAllPushTokens } from "@/lib/push/service";
import { adminAuth } from "@/lib/firebase/admin";
import { isSameOrigin } from "@/lib/security/origin";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

const LoginBody = z.object({
  idToken: z.string().min(100).max(4096),
});

// Only mint a 5-day session from a sign-in that happened moments ago, so a
// stolen (older) ID token can't be upgraded into a long-lived session.
const MAX_SIGN_IN_AGE_SEC = 5 * 60;

function error(status: number, message: string, extraHeaders?: HeadersInit) {
  return NextResponse.json({ error: message }, { status, headers: extraHeaders });
}

// POST /api/auth/session  — exchange a fresh Firebase ID token for a session cookie
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return error(403, "Bad origin");

  const limit = rateLimit(`login:${clientIp(request.headers)}`, 10, 60_000);
  if (!limit.ok) {
    return error(429, "Too many attempts. Try again shortly.", {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  const parsed = LoginBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error(400, "Invalid request");

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(parsed.data.idToken, true);
  } catch {
    return error(401, "Invalid or expired sign-in");
  }

  if (Date.now() / 1000 - decoded.auth_time > MAX_SIGN_IN_AGE_SEC) {
    return error(401, "Sign-in is too old. Please sign in again.");
  }
  if (!decoded.email) return error(400, "Account has no email address");
  // Google accounts arrive verified; email/password users must click the
  // verification link first. A finance app shouldn't run on unproven emails.
  if (!decoded.email_verified) return error(403, "Please verify your email first.");

  const sessionCookie = await adminAuth.createSessionCookie(parsed.data.idToken, {
    expiresIn: SESSION_MAX_AGE_SEC * 1000,
  });

  // Create-or-update the user and write the audit row in ONE transaction.
  await db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { firebaseUid: decoded.uid },
      create: {
        firebaseUid: decoded.uid,
        email: decoded.email!,
        displayName: (decoded.name as string | undefined) ?? null,
      },
      update: { email: decoded.email! },
      select: { id: true },
    });
    await ensureCashAccount(tx, user.id);
    await writeAudit(
      tx,
      {
        userId: user.id,
        action: "auth.login",
        metadata: { provider: decoded.firebase.sign_in_provider },
      },
      request.headers,
    );
  });

  (await cookies()).set(SESSION_COOKIE, sessionCookie, sessionCookieOptions(SESSION_MAX_AGE_SEC));
  return NextResponse.json({ ok: true });
}

// DELETE /api/auth/session  — log out (this device AND every other session)
export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return error(403, "Bad origin");

  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE)?.value;
  cookieStore.set(SESSION_COOKIE, "", sessionCookieOptions(0));

  if (cookie) {
    try {
      const decoded = await adminAuth.verifySessionCookie(cookie, false);
      // Revoking refresh tokens invalidates all session cookies for this user,
      // because getSessionUser() checks revocation on every request.
      await adminAuth.revokeRefreshTokens(decoded.uid);

      const user = await db.user.findUnique({
        where: { firebaseUid: decoded.uid },
        select: { id: true },
      });
      if (user) {
        await removeAllPushTokens(user.id); // signed out everywhere: no more pushes
        await db.$transaction((tx) =>
          writeAudit(tx, { userId: user.id, action: "auth.logout" }, request.headers),
        );
      }
    } catch {
      // Cookie already invalid; clearing it was enough.
    }
  }
  return NextResponse.json({ ok: true });
}
