// PayTra import worker (Cloud Run, port 5004 locally).
//
// Flow: browser PUTs a statement to the private bucket (signed URL) ->
// Cloud Storage publishes OBJECT_FINALIZE to Pub/Sub -> Pub/Sub pushes it
// here (authenticated with an OIDC token; Cloud Run rejects anyone else) ->
// we parse the file, store the preview on the import job, delete the file.
// The user then confirms in the web app, which writes the transactions.
//
// Shares the exact parsing code with the web app (src/lib/imports/core.ts).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { PrismaPg } from "@prisma/adapter-pg";
import { Storage } from "@google-cloud/storage";

import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { isoDateIST } from "../src/lib/dates";
import { MAX_FILE_BYTES, parseFile, toStored } from "../src/lib/imports/core";

const PORT = Number(process.env.PORT ?? 5004);
const BUCKET = process.env.STATEMENTS_BUCKET;
const DATABASE_URL = process.env.DATABASE_URL;
if (!BUCKET || !DATABASE_URL) throw new Error("STATEMENTS_BUCKET and DATABASE_URL must be set");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
const bucket = new Storage().bucket(BUCKET);

const OBJECT_RE = /^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
const MAX_BODY = 64 * 1024; // a Pub/Sub push envelope is small

// Structured logs (Cloud Logging parses JSON lines). Never log file contents,
// narrations, amounts or user emails: job ids and outcomes only.
function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, ...fields }));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

type PushEnvelope = { message?: { attributes?: Record<string, string>; messageId?: string } };

async function handleUpload(objectPath: string, messageId: string | undefined) {
  // Claim: only one delivery of this message gets to process the job. A job
  // stuck in PARSING for 2+ minutes (worker crashed mid-way) can be
  // reclaimed by Pub/Sub's retry, at most 3 attempts in total.
  const claimed = await db.importJob.updateMany({
    where: {
      objectPath,
      expiresAt: { gt: new Date() },
      attempts: { lt: 3 },
      OR: [{ status: "AWAITING_UPLOAD" }, { status: "PARSING", updatedAt: { lt: new Date(Date.now() - 120_000) } }],
    },
    data: { status: "PARSING", attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    log("INFO", "no claimable job (duplicate delivery, expired or unknown)", { messageId });
    await bucket.file(objectPath).delete({ ignoreNotFound: true });
    return;
  }

  const job = await db.importJob.findUniqueOrThrow({
    where: { objectPath },
    select: { id: true, accountId: true, fileName: true, source: true },
  });
  const file = bucket.file(objectPath);

  try {
    const [meta] = await file.getMetadata();
    if (Number(meta.size) > MAX_FILE_BYTES) {
      await fail(job.id, "File is larger than 1 MB. Export a shorter period.");
      return;
    }
    const [buffer] = await file.download();
    // No password on this path: locked PDFs are handled by the web app so a
    // password never sits in a queue.
    const parsed = await parseFile(new Uint8Array(buffer), job.fileName, job.accountId, isoDateIST());

    if (!parsed.ok) {
      await fail(job.id, parsed.error, parsed.needsPassword);
      return;
    }
    await db.importJob.update({
      where: { id: job.id },
      data: { status: "READY", fileSha256: parsed.fileSha256, result: toStored(parsed) as unknown as Prisma.InputJsonValue, error: null },
    });
    log("INFO", "import parsed", { jobId: job.id, rows: parsed.rows.length, errors: parsed.errors.length, balance: parsed.balance.status });
  } catch (e) {
    log("ERROR", "import failed", { jobId: job.id, error: e instanceof Error ? e.message : String(e) });
    await fail(job.id, "Something went wrong reading this file. Please try again.");
  } finally {
    // The statement is gone from the bucket as soon as we've read it
    // (the bucket's 1-day lifecycle rule is only a backstop).
    await file.delete({ ignoreNotFound: true }).catch((e) => log("WARNING", "delete failed", { jobId: job.id, error: String(e) }));
  }
}

async function fail(jobId: string, error: string, needsPassword = false) {
  await db.importJob.update({
    where: { id: jobId },
    data: { status: "FAILED", error, result: needsPassword ? { needsPassword: true } : Prisma.DbNull },
  });
  log("INFO", "import rejected", { jobId, needsPassword });
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  // Not /healthz: Cloud Run reserves URL paths ending in "z".
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.method !== "POST" || req.url !== "/") {
    res.writeHead(404).end();
    return;
  }

  let envelope: PushEnvelope;
  try {
    envelope = JSON.parse(await readBody(req)) as PushEnvelope;
  } catch {
    res.writeHead(400).end(); // malformed: retrying won't help
    return;
  }

  const attrs = envelope.message?.attributes ?? {};
  // Only "a new object finished uploading" in OUR bucket, at a well-formed path.
  if (attrs.eventType !== "OBJECT_FINALIZE" || attrs.bucketId !== BUCKET || !OBJECT_RE.test(attrs.objectId ?? "")) {
    log("WARNING", "ignored message", { eventType: attrs.eventType, messageId: envelope.message?.messageId });
    res.writeHead(204).end(); // ack: nothing to do
    return;
  }

  try {
    await handleUpload(attrs.objectId!, envelope.message?.messageId);
    res.writeHead(204).end(); // ack
  } catch (e) {
    // Infrastructure error (DB/storage down): non-2xx makes Pub/Sub retry
    // with backoff. The claim above keeps retries from double-processing.
    log("ERROR", "transient failure, will retry", { error: e instanceof Error ? e.message : String(e) });
    res.writeHead(500).end();
  }
}

createServer((req, res) => {
  handle(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500).end();
  });
}).listen(PORT, () => log("INFO", `worker listening on ${PORT}`));
