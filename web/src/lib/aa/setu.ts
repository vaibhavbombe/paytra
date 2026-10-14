import "server-only";

import { z } from "zod";

// Setu Account Aggregator (FIU) API client: SANDBOX ONLY, mock bank data.
// Production would need business KYC, Setu review and Sahamati FIU onboarding.
//
// Auth: x-client-id / x-client-secret / x-product-instance-id headers
// (verified against the sandbox: a wrong secret -> 401 "Invalid client secret").
// Request format verified too: the purpose must be ReBIT's Purpose object.

const BASE = process.env.SETU_AA_BASE_URL ?? "https://fiu-sandbox.setu.co";
const TIMEOUT_MS = 15_000;

export class SetuError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function headers() {
  const id = process.env.SETU_CLIENT_ID;
  const secret = process.env.SETU_CLIENT_SECRET;
  const pid = process.env.SETU_PRODUCT_INSTANCE_ID;
  if (!id || !secret || !pid) throw new SetuError(500, "NotConfigured", "Account Aggregator isn't configured on this server.");
  return { "Content-Type": "application/json", "x-client-id": id, "x-client-secret": secret, "x-product-instance-id": pid };
}

async function call<T>(method: "GET" | "POST", path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    throw new SetuError(503, "Unreachable", `Couldn't reach the Account Aggregator (${e instanceof Error ? e.name : "network"}).`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const j = (json ?? {}) as { errorCode?: string; errorMsg?: string; message?: string };
    throw new SetuError(res.status, j.errorCode ?? "Error", j.errorMsg ?? j.message ?? `Setu returned ${res.status}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new SetuError(502, "BadResponse", "Unexpected response from the Account Aggregator.");
  return parsed.data;
}

// ── Consents ──

/** ReBIT purpose 102: "Customer spending patterns, budget or other reportings". */
export const PURPOSE_102 = {
  code: "102",
  refUri: "https://api.rebit.org.in/aa/purpose/102.xml",
  text: "Customer spending patterns, budget or other reportings",
  category: { type: "Personal Finance" },
} as const;

const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";

const ConsentCreated = z.object({ id: z.string(), url: z.string().url(), status: z.string() });

/**
 * Data minimisation: only DEPOSIT accounts, only TRANSACTIONS + SUMMARY
 * (balance), never PROFILE (name, PAN, address); one fetch; kept 1 month.
 */
export function createConsent(input: { vua: string; from: Date; to: Date; redirectUrl: string }) {
  return call("POST", "/v2/consents", ConsentCreated, {
    consentDuration: { unit: "MONTH", value: "1" },
    vua: input.vua,
    dataRange: { from: iso(input.from), to: iso(input.to) },
    consentMode: "STORE",
    fetchType: "ONETIME",
    consentTypes: ["TRANSACTIONS", "SUMMARY"],
    fiTypes: ["DEPOSIT"],
    dataLife: { unit: "MONTH", value: 1 },
    frequency: { unit: "MONTH", value: 1 },
    purpose: PURPOSE_102,
    redirectUrl: input.redirectUrl,
    context: [],
  });
}

const ConsentStatus = z.object({
  id: z.string(),
  status: z.string(), // PENDING | ACTIVE | APPROVED | REJECTED | REVOKED | EXPIRED | PAUSED
  accountsLinked: z.array(z.object({ maskedAccNumber: z.string().optional(), fipId: z.string().optional() }).passthrough()).optional().nullable(),
}).passthrough();

export function getConsent(consentId: string) {
  return call("GET", `/v2/consents/${encodeURIComponent(consentId)}`, ConsentStatus);
}

export function revokeConsent(consentId: string) {
  return call("POST", `/v2/consents/${encodeURIComponent(consentId)}/revoke`, z.unknown());
}

// ── Data sessions ──

const SessionCreated = z.object({ id: z.string(), status: z.string() }).passthrough();

export function createDataSession(consentId: string, from: Date, to: Date) {
  return call("POST", "/v2/sessions", SessionCreated, {
    consentId,
    dataRange: { from: iso(from), to: iso(to) },
    format: "json",
  });
}

// Shapes are parsed defensively (the docs' samples were inconsistent:
// "status" vs "FIstatus"); only the fields we use are required.
const AaTxn = z
  .object({
    type: z.string(),
    amount: z.union([z.string(), z.number()]),
    currentBalance: z.union([z.string(), z.number()]).optional().nullable(),
    valueDate: z.string().optional().nullable(),
    transactionTimestamp: z.string().optional().nullable(),
    narration: z.string().optional().nullable(),
    reference: z.string().optional().nullable(),
    txnId: z.string().optional().nullable(),
    mode: z.string().optional().nullable(),
  })
  .passthrough();

const AaAccount = z
  .object({
    maskedAccNumber: z.string().optional().nullable(),
    linkRefNumber: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
    FIstatus: z.string().optional().nullable(),
    data: z
      .object({
        account: z
          .object({
            type: z.string().optional().nullable(),
            maskedAccNumber: z.string().optional().nullable(),
            summary: z.record(z.string(), z.unknown()).optional().nullable(),
            transactions: z
              .object({ transaction: z.union([z.array(AaTxn), AaTxn]).optional().nullable() })
              .passthrough()
              .optional()
              .nullable(),
          })
          .passthrough()
          .optional()
          .nullable(),
      })
      .passthrough()
      .optional()
      .nullable(),
  })
  .passthrough();

const Session = z
  .object({
    id: z.string(),
    status: z.string(), // PENDING | PARTIAL | COMPLETED | EXPIRED | FAILED
    fips: z.array(z.object({ fipID: z.string().optional().nullable(), accounts: z.array(AaAccount).optional().nullable() }).passthrough()).optional().nullable(),
  })
  .passthrough();

export type AaSession = z.infer<typeof Session>;
export type AaTransaction = z.infer<typeof AaTxn>;

export function getDataSession(sessionId: string) {
  return call("GET", `/v2/sessions/${encodeURIComponent(sessionId)}`, Session);
}
