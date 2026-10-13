import { headers } from "next/headers";

import { writeAudit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth/session";
import { isoDateIST } from "@/lib/dates";
import { db } from "@/lib/db";
import { exportUserData } from "@/lib/privacy/service";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

// GET /api/export: "download my data" as a JSON file.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const h = await headers();
  if (!rateLimit(`export:${user.id}:${clientIp(h)}`, 5, 60 * 60_000).ok) {
    return new Response("Too many exports. Try again in an hour.", { status: 429 });
  }

  const data = await exportUserData(user.id);
  await db.$transaction((tx) => writeAudit(tx, { userId: user.id, action: "data.export" }, h));

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="paytra-export-${isoDateIST()}.json"`,
      "Cache-Control": "no-store", // personal data: never cached by browsers or proxies
    },
  });
}
