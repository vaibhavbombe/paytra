"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { removePushToken, savePushToken, sendPush } from "@/lib/push/service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

const Token = z.string().min(20).max(4096);

export async function enablePush(token: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  if (!Token.safeParse(token).success) return { ok: false, error: "Invalid device token." };
  const h = await headers();
  await savePushToken(user.id, token, h.get("user-agent"));
  await db.$transaction((tx) => writeAudit(tx, { userId: user.id, action: "push.enable" }, h));
  return { ok: true };
}

export async function disablePush(token: string): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user || !Token.safeParse(token).success) return { ok: false };
  const h = await headers();
  await removePushToken(user.id, token);
  await db.$transaction((tx) => writeAudit(tx, { userId: user.id, action: "push.disable" }, h));
  return { ok: true };
}

/** "Send a test notification" button. Rate-limited: it reaches real devices. */
export async function testPush(): Promise<{ ok: boolean; delivered?: number; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session has expired." };
  if (!rateLimit(`push-test:${user.id}:${clientIp(await headers())}`, 3, 60_000).ok) {
    return { ok: false, error: "Too many test notifications. Try again in a minute." };
  }
  const delivered = await sendPush(user.id, {
    title: "PayTra test",
    body: "Push alerts are working on this device.",
    url: "/budgets",
    tag: "paytra-test",
  });
  return { ok: true, delivered };
}
