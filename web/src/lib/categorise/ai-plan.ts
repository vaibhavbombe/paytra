import { createHash } from "node:crypto";

import type { AiCategory, AiPayee, AiSuggestion } from "@/lib/ai/client";

import { kindFitsDirection, matchText } from "./engine";

export const AI_BATCH_LIMIT = 50; // the AI service accepts at most 50 payees
const PAYEE_MAX = 80;

type Uncategorised = { id: string; direction: "DEBIT" | "CREDIT"; merchant: string | null; description: string };
type CategoryRow = { id: string; name: string; kind: AiCategory["kind"]; userId: string | null };

export type AiPlan = {
  items: AiPayee[];
  // item id → transaction ids with that payee + direction
  transactionIds: Map<string, string[]>;
  // distinct payees not sent this time (over the batch limit)
  leftOver: number;
};

/**
 * One item per distinct payee + direction, not per transaction: 40 Swiggy
 * orders are one question. Most frequent payees first, so a batch helps the
 * most transactions. Only the clean payee text goes out, never amounts.
 */
export function planAiBatch(txs: Uncategorised[]): AiPlan {
  const groups = new Map<string, { item: AiPayee; ids: string[] }>();
  for (const t of txs) {
    const key = matchText(t);
    if (!key) continue;
    const id = createHash("sha256").update(`${t.direction}|${key}`).digest("base64url").slice(0, 22);
    const g = groups.get(id) ?? { item: { id, payee: (t.merchant ?? t.description).trim().slice(0, PAYEE_MAX), direction: t.direction }, ids: [] };
    g.ids.push(t.id);
    groups.set(id, g);
  }
  const sorted = [...groups.values()].sort((a, b) => b.ids.length - a.ids.length || a.item.payee.localeCompare(b.item.payee));
  const batch = sorted.slice(0, AI_BATCH_LIMIT);
  return {
    items: batch.map((g) => g.item),
    transactionIds: new Map(batch.map((g) => [g.item.id, g.ids])),
    leftOver: sorted.length - batch.length,
  };
}

/** Names the model may choose from; a user's own category wins a name clash. */
export function aiCategoryOptions(categories: CategoryRow[]): { options: AiCategory[]; byName: Map<string, CategoryRow> } {
  const byName = new Map<string, CategoryRow>();
  for (const c of categories) {
    const seen = byName.get(c.name);
    if (!seen || (seen.userId === null && c.userId !== null)) byName.set(c.name, c);
  }
  return { options: [...byName.values()].map((c) => ({ name: c.name, kind: c.kind })), byName };
}

/**
 * Which suggestions to apply. Only "high" confidence: an unsure guess stays
 * uncategorised for the user. The service already validates, but the web app
 * checks again (name exists, kind fits direction) because it owns the data.
 */
export function aiUpdates(plan: AiPlan, suggestions: AiSuggestion[], byName: Map<string, CategoryRow>) {
  const directions = new Map(plan.items.map((i) => [i.id, i.direction]));
  const updates = new Map<string, string[]>(); // categoryId → transaction ids
  let unsure = 0;
  for (const s of suggestions) {
    const direction = directions.get(s.id);
    const ids = plan.transactionIds.get(s.id);
    if (!direction || !ids) continue;
    const category = s.category ? byName.get(s.category) : undefined;
    if (!category || s.confidence !== "high" || !kindFitsDirection(category.kind, direction)) {
      unsure++;
      continue;
    }
    updates.set(category.id, [...(updates.get(category.id) ?? []), ...ids]);
  }
  return { updates, unsure };
}
