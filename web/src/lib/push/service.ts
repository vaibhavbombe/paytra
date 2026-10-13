import "server-only";

import { db } from "@/lib/db";
import { adminMessaging } from "@/lib/firebase/admin";

const MAX_DEVICES = 10;

// FCM errors that mean "this token will never work again": forget it.
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/** Short, non-identifying label from the user agent ("Chrome on Android"). */
export function deviceLabel(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "device";
  return `${browser} on ${os}`;
}

export async function savePushToken(userId: string, token: string, userAgent: string | null) {
  const device = deviceLabel(userAgent);
  await db.$transaction(async (tx) => {
    // A token belongs to one browser profile; if another account used it
    // before on this device, it moves to the current user.
    await tx.pushToken.upsert({
      where: { token },
      create: { userId, token, device },
      update: { userId, device, lastSeenAt: new Date() },
    });
    // Keep the newest few devices per user.
    const stale = await tx.pushToken.findMany({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
      skip: MAX_DEVICES,
      select: { id: true },
    });
    if (stale.length) await tx.pushToken.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  });
}

export async function removePushToken(userId: string, token: string) {
  await db.pushToken.deleteMany({ where: { userId, token } });
}

export async function removeAllPushTokens(userId: string) {
  await db.pushToken.deleteMany({ where: { userId } });
}

export type PushMessage = { title: string; body: string; url: string; tag: string };

/**
 * Send to every device of the user. Data-only message: our own service
 * worker (public/push-sw.js) shows it, so the content is under our control.
 * Returns how many devices accepted it; dead tokens are deleted.
 */
export async function sendPush(userId: string, message: PushMessage): Promise<number> {
  const tokens = (await db.pushToken.findMany({ where: { userId }, select: { token: true } })).map((t) => t.token);
  if (tokens.length === 0) return 0;

  const res = await adminMessaging.sendEachForMulticast({
    tokens,
    data: message,
    webpush: { headers: { Urgency: "high", TTL: String(24 * 60 * 60) } }, // drop if undelivered for a day
  });

  const dead = res.responses.flatMap((r, i) => (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code) ? [tokens[i]] : []));
  if (dead.length) await db.pushToken.deleteMany({ where: { token: { in: dead } } });
  return res.successCount;
}
