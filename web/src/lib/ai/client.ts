import "server-only";

import { z } from "zod";

// The AI service (ai/, FastAPI). Locally plain http on 127.0.0.1:8002; on
// Cloud Run a private service, so each call carries a Google-signed ID token
// for this service's account (the only one allowed to invoke it).
const TIMEOUT_MS = 30_000;

export type AiPayee = { id: string; payee: string; direction: "DEBIT" | "CREDIT"; channel?: string };
export type AiCategory = { name: string; kind: "EXPENSE" | "INCOME" | "TRANSFER" };

const CategoriseResponse = z.object({
  suggestions: z.array(
    z.object({ id: z.string(), category: z.string().nullable(), confidence: z.enum(["high", "low"]).nullable() }),
  ),
  model: z.string(),
});
export type AiSuggestion = z.infer<typeof CategoriseResponse>["suggestions"][number];

export class AiUnavailable extends Error {}

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_SERVICE_URL);
}

async function idToken(audience: string): Promise<string | null> {
  if (!audience.startsWith("https://")) return null; // local dev
  // Cloud Run metadata server: an ID token for this service's own account.
  const res = await fetch(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
    { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5_000) },
  );
  if (!res.ok) throw new AiUnavailable(`identity token: ${res.status}`);
  return res.text();
}

async function post(path: string, body: unknown): Promise<unknown> {
  const base = process.env.AI_SERVICE_URL;
  if (!base) throw new AiUnavailable("AI_SERVICE_URL not set");
  const token = await idToken(base);
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new AiUnavailable(e instanceof Error ? e.name : "fetch failed");
  }
  if (!res.ok) throw new AiUnavailable(`AI service: ${res.status}`);
  return res.json();
}

export async function aiCategorise(items: AiPayee[], categories: AiCategory[]) {
  // Validate the response too: the web app trusts nothing that crosses a boundary.
  return CategoriseResponse.parse(await post("/v1/categorise", { items, categories }));
}

const PlanResponse = z.object({ plan: z.unknown(), model: z.string() });

/** Insights step 1: question → one read-only query plan (checked again by the caller). */
export async function aiPlanInsight(question: string, today: string, categories: string[]) {
  return PlanResponse.parse(await post("/v1/insights/plan", { question, today, categories }));
}
