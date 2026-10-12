// Statement-file processing shared by the web app AND the background worker.
// Deliberately free of Next.js / "server-only" imports so the worker (plain
// Node) can bundle it. No database access here: callers do I/O.

import { createHash } from "node:crypto";

import { readPdfStatement } from "./pdf";
import {
  parseStatement,
  parseStatementTable,
  type BalanceCheck,
  type ParsedStatement,
  type RowError,
  type StatementRow,
} from "./statement";

export const MAX_FILE_BYTES = 1024 * 1024; // 1 MB ≈ several years of rows
export const MAX_PDF_PASSWORD = 64;

export type FileKind = "CSV" | "PDF";

export type ParsedFile =
  | { ok: false; error: string; needsPassword?: boolean }
  | {
      ok: true;
      source: FileKind;
      fileSha256: string;
      rows: StatementRow[];
      errors: RowError[];
      balance: BalanceCheck;
      period: { from: string; to: string } | null;
    };

/** "CSV" | "PDF" from the file name, or null if unsupported. */
export function kindFromName(name: string): FileKind | null {
  if (/\.csv$/i.test(name)) return "CSV";
  if (/\.pdf$/i.test(name)) return "PDF";
  return null;
}

/**
 * Validate and parse an uploaded statement. Decides the type by CONTENT
 * (a PDF starts with "%PDF-"), and requires it to match the file name.
 * `password` is the PDF's own file password: used once, never stored.
 */
export async function parseFile(
  bytes: Uint8Array,
  fileName: string,
  accountId: string,
  today: string,
  password?: string,
): Promise<ParsedFile> {
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: "File is larger than 1 MB. Export a shorter period." };

  const kind = kindFromName(fileName);
  if (!kind) return { ok: false, error: "Only .csv and .pdf statements are supported." };
  const isPdf = bytes.length > 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
  if (isPdf !== (kind === "PDF")) {
    return { ok: false, error: isPdf ? "That file is a PDF; rename it to .pdf or choose the CSV." : "That file isn't a valid PDF." };
  }

  let parsed: ParsedStatement;
  if (isPdf) {
    const pdf = await readPdfStatement(bytes, password ? password.slice(0, MAX_PDF_PASSWORD) : undefined);
    if (!pdf.ok) {
      return {
        ok: false,
        error: pdf.message,
        needsPassword: pdf.reason === "password-required" || pdf.reason === "password-incorrect",
      };
    }
    parsed = parseStatementTable(pdf.table, accountId, today);
  } else {
    // Binary files (e.g. a renamed XLSX) contain NUL bytes; CSV never does.
    if (bytes.includes(0)) return { ok: false, error: "That doesn't look like a CSV text file." };
    parsed = parseStatement(new TextDecoder("utf-8").decode(bytes), accountId, today);
  }
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.rows.length === 0 && parsed.errors.length === 0) {
    return { ok: false, error: "No transactions found in the file." };
  }

  return {
    ok: true,
    source: kind,
    fileSha256: createHash("sha256").update(bytes).digest("hex"),
    rows: parsed.rows,
    errors: parsed.errors,
    balance: parsed.balance,
    period: parsed.period,
  };
}

// ── Storing a parse result in import_jobs.result (JSON has no BigInt) ──

export type StoredResult = {
  v: 1;
  fileSha256: string;
  rows: (Omit<StatementRow, "amountPaise" | "balancePaise"> & { amountPaise: string; balancePaise: string | null })[];
  errors: RowError[];
  balance: BalanceCheck;
  period: { from: string; to: string } | null;
};

export function toStored(p: Extract<ParsedFile, { ok: true }>): StoredResult {
  return {
    v: 1,
    fileSha256: p.fileSha256,
    rows: p.rows.map((r) => ({
      ...r,
      amountPaise: r.amountPaise.toString(),
      balancePaise: r.balancePaise === null ? null : r.balancePaise.toString(),
    })),
    errors: p.errors,
    balance: p.balance,
    period: p.period,
  };
}

export function fromStored(s: StoredResult, source: FileKind): Extract<ParsedFile, { ok: true }> {
  if (s?.v !== 1) throw new Error("Unknown stored import format");
  return {
    ok: true,
    source,
    fileSha256: s.fileSha256,
    rows: s.rows.map((r) => ({
      ...r,
      amountPaise: BigInt(r.amountPaise),
      balancePaise: r.balancePaise === null ? null : BigInt(r.balancePaise),
    })),
    errors: s.errors,
    balance: s.balance,
    period: s.period,
  };
}
