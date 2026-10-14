import { headers } from "next/headers";
import { z } from "zod";

import { consentOwner, syncConsent } from "@/lib/aa/service";
import { checkBudgetsQuietly } from "@/lib/budgets/service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

// POST /api/aa/notifications: Setu's webhook (consent status / data ready).
//
// The payload is NOT trusted: anyone can POST here. It's only used as a hint
// to look up which consent to re-check, and syncConsent then reads the real
// status from Setu's API with our credentials. The worst a forged call can do
// is trigger a harmless re-check, and that's rate limited.

const Notification = z
  .object({
    consentId: z.string().max(100).optional(),
    data: z.object({ consentId: z.string().max(100).optional() }).passthrough().optional(),
  })
  .passthrough();

export async function POST(request: Request) {
  const h = await headers();
  if (!rateLimit(`aa-webhook:${clientIp(h)}`, 60, 60_000).ok) return new Response(null, { status: 429 });

  const body = Notification.safeParse(await request.json().catch(() => null));
  const setuConsentId = body.success ? (body.data.consentId ?? body.data.data?.consentId) : undefined;
  if (!setuConsentId) return new Response(null, { status: 204 }); // nothing we act on; ack anyway

  const owner = await consentOwner(setuConsentId);
  if (owner) {
    try {
      const view = await syncConsent(owner.userId, owner.id, h);
      if (view.phase === "imported" && view.summary?.inserted) await checkBudgetsQuietly(owner.userId);
    } catch (e) {
      console.error(JSON.stringify({ severity: "ERROR", message: "aa webhook sync failed", error: String(e) }));
    }
  }
  // Always 200 for known/unknown ids: don't reveal which consent ids exist.
  return new Response(null, { status: 200 });
}
