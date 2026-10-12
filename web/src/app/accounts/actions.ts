"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export type AddAccountState = { status: "idle" } | { status: "error"; message: string } | { status: "saved"; message: string };

const AccountInput = z.object({
  institutionName: z.string().trim().min(2, "Enter the bank name").max(60),
  nickname: z.string().trim().max(40).optional().default(""),
  type: z.enum(["SAVINGS", "CURRENT", "CREDIT_CARD"]),
  // Masking by design: we only ever accept the LAST 4 digits, never the full
  // account number, so there's nothing sensitive to leak.
  last4: z.string().regex(/^\d{4}$/, "Enter exactly the last 4 digits"),
});

export async function addAccount(formData: FormData): Promise<AddAccountState> {
  const user = await getSessionUser();
  if (!user) return { status: "error", message: "Your session has expired. Please sign in again." };

  const parsed = AccountInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0].message };
  const input = parsed.data;

  const count = await db.account.count({ where: { userId: user.id } });
  if (count >= 20) return { status: "error", message: "You can add up to 20 accounts." };

  await db.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        userId: user.id,
        institutionName: input.institutionName,
        nickname: input.nickname || null,
        type: input.type,
        last4: input.last4,
      },
      select: { id: true },
    });
    await writeAudit(
      tx,
      { userId: user.id, action: "account.create", entityType: "account", entityId: account.id, metadata: { type: input.type } },
      await headers(),
    );
  });

  refresh();
  return { status: "saved", message: `${input.institutionName} ••${input.last4} added.` };
}
