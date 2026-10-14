"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { AiUnavailable, aiConfigured } from "@/lib/ai/client";
import { getSessionUser } from "@/lib/auth/session";
import { askInsight, type InsightResult } from "@/lib/insights/service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

const Question = z.string().trim().min(3, "Please type a question.").max(300, "Please keep it under 300 characters.");

export async function ask(question: string, acknowledged: boolean): Promise<{ ok: true; result: InsightResult } | { ok: false; error: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
  if (!aiConfigured()) return { ok: false, error: "Questions aren't set up on this server." };
  // Consent first: the question text goes to the free-tier model.
  if (acknowledged !== true) return { ok: false, error: "Please confirm before sending your question to the AI." };
  const q = Question.safeParse(question);
  if (!q.success) return { ok: false, error: q.error.issues[0].message };
  const h = await headers();
  if (!rateLimit(`insights:${user.id}:${clientIp(h)}`, 20, 60 * 60_000).ok) {
    return { ok: false, error: "Too many questions. Try again later." };
  }
  try {
    return { ok: true, result: await askInsight(user.id, q.data, h) };
  } catch (e) {
    if (e instanceof AiUnavailable) return { ok: false, error: "The AI service isn't available right now. Try again in a minute." };
    throw e;
  }
}
