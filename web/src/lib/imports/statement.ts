import { createHash } from "node:crypto";

import { parseDecimalToPaise, MAX_AMOUNT_PAISE } from "@/lib/money";

import { parseCsv } from "./csv";
import { describe, parseNarration, type Channel } from "./narration";

// Turns a bank statement CSV into validated rows.
//
// Header-driven: we look for the header row (banks put account details,
// address and disclaimers above it) and map columns by name, so HDFC, SBI,
// ICICI, Axis-style exports work without a per-bank parser. Supports
// separate Withdrawal/Deposit columns OR one Amount column + a Dr/Cr column.

type Field = "date" | "narration" | "reference" | "valueDate" | "debit" | "credit" | "amount" | "drcr" | "balance";

// Compared after normalising: lowercase, letters/digits only.
const HEADER_ALIASES: Record<Field, string[]> = {
  date: ["date", "txndate", "transactiondate", "trandate", "postdate", "postingdate"],
  narration: ["narration", "description", "particulars", "transactionremarks", "remarks", "details", "transactiondetails"],
  reference: ["chqrefno", "refnochequeno", "chequeno", "chqno", "referenceno", "refno", "chequerefno", "utrno"],
  valueDate: ["valuedt", "valuedate"],
  debit: ["withdrawalamt", "withdrawalamountinr", "withdrawalamount", "withdrawal", "withdrawals", "debit", "debitamount", "dramount", "debits"],
  credit: ["depositamt", "depositamountinr", "depositamount", "deposit", "deposits", "credit", "creditamount", "cramount", "credits"],
  amount: ["amount", "amountinr", "transactionamount", "txnamount"],
  drcr: ["drcr", "crdr", "type", "transactiontype", "debitcredit"],
  balance: ["closingbalance", "balance", "balanceinr", "runningbalance", "availablebalance"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export type ColumnMap = Partial<Record<Field, number>>;

export function detectColumns(header: string[]): ColumnMap | null {
  const map: ColumnMap = {};
  header.forEach((cell, i) => {
    const n = norm(cell);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [Field, string[]][]) {
      if (map[field] === undefined && aliases.includes(n)) {
        map[field] = i;
        break;
      }
    }
  });
  const hasAmounts = (map.debit !== undefined && map.credit !== undefined) || (map.amount !== undefined && map.drcr !== undefined);
  return map.date !== undefined && map.narration !== undefined && hasAmounts ? map : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Indian statement dates -> "YYYY-MM-DD". Day-first only (never MM/DD). */
export function parseStatementDate(input: string): string | null {
  const s = input.trim();
  let d: number, m: number, y: number;

  let match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/); // 05/10/26, 05-10-2026
  if (match) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{1,2})[\s/-]([A-Za-z]{3,4})[\s/,-]+(\d{2}|\d{4})$/))) {
    // 05-Oct-2026, 05 Oct 2026, 5 Sept 26
    const mon = MONTHS[match[2].toLowerCase()];
    if (!mon) return null;
    [d, m, y] = [Number(match[1]), mon, Number(match[3])];
  } else if ((match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }

  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject impossible dates like 31/02 (Date would roll them over).
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** "" / "0.00" / "-" -> 0n; "1,500.00" -> 150000n; anything else -> null. */
function amountCell(input: string | undefined): bigint | null {
  const s = (input ?? "").trim();
  if (s === "" || s === "-") return 0n;
  return parseDecimalToPaise(s);
}

/** Balances may carry a Dr/Cr suffix or a minus sign (overdrawn). */
function balanceCell(input: string | undefined): bigint | null {
  let s = (input ?? "").trim();
  if (!s) return null;
  let sign = 1n;
  if (/\bdr\.?$/i.test(s) || s.startsWith("-")) sign = -1n;
  s = s.replace(/\s*(cr|dr)\.?$/i, "").replace(/^-/, "");
  const v = parseDecimalToPaise(s);
  return v === null ? null : sign * v;
}

export type StatementRow = {
  line: number; // 1-based line in the file, for error messages
  txnDate: string;
  direction: "DEBIT" | "CREDIT";
  amountPaise: bigint;
  balancePaise: bigint | null;
  channel: Channel;
  description: string;
  merchant: string | null;
  reference: string | null;
  fingerprint: string;
};

export type RowError = { line: number; message: string };

export type BalanceCheck =
  | { status: "unavailable" }
  | { status: "ok"; checked: number }
  | { status: "mismatch"; checked: number; firstBadLine: number };

export type ParsedStatement =
  | { ok: false; error: string }
  | {
      ok: true;
      headerLine: number;
      rows: StatementRow[];
      errors: RowError[];
      balance: BalanceCheck;
      period: { from: string; to: string } | null;
    };

export const MAX_ROWS = 5000;

export const FOOTER_RE = /^(statement summary|opening balance|closing balance|summary|total|\*{3,}|-{3,}end)/i;

/**
 * Parse a statement for ONE account. `today` (IST) rejects future dates.
 * Pure function: no database access; the caller decides what's new.
 */
export function parseStatement(text: string, accountId: string, today: string): ParsedStatement {
  return parseStatementTable(parseCsv(text), accountId, today);
}

/**
 * Same as parseStatement, for a table that's already split into cells
 * (the PDF reader rebuilds one from text positions). CSV and PDF share every
 * rule below, so the same transaction gets the same fingerprint from either.
 */
export function parseStatementTable(table: string[][], accountId: string, today: string): ParsedStatement {
  // The header is usually within the first lines; banks add preamble above it.
  let headerIndex = -1;
  let cols: ColumnMap | null = null;
  for (let i = 0; i < Math.min(table.length, 40); i++) {
    cols = detectColumns(table[i]);
    if (cols) {
      headerIndex = i;
      break;
    }
  }
  if (!cols) {
    return {
      ok: false,
      error:
        "Couldn't find the column headings. The CSV needs a Date column, a Narration/Description column and either Withdrawal + Deposit columns or Amount + Dr/Cr.",
    };
  }

  const rows: StatementRow[] = [];
  const errors: RowError[] = [];
  const keyCounts = new Map<string, number>();

  for (let i = headerIndex + 1; i < table.length; i++) {
    const cells = table[i];
    const line = i + 1;
    const get = (f: Field) => (cols![f] === undefined ? "" : (cells[cols![f]!] ?? "").trim());

    // Footer: banks append a summary block ("STATEMENT SUMMARY", "Opening
    // Balance, Dr Count, ..."). Nothing after it is a transaction.
    if (cells.some((c) => FOOTER_RE.test(c.trim()))) break;
    if (cells.every((c) => c.trim() === "")) continue;
    const rawDate = get("date");
    if (!rawDate || /^\*+$/.test(rawDate)) continue;
    if (!/\d/.test(rawDate)) continue;

    if (rows.length + errors.length >= MAX_ROWS) {
      errors.push({ line, message: `Stopped after ${MAX_ROWS} rows. Split the statement into smaller periods.` });
      break;
    }

    const txnDate = parseStatementDate(rawDate);
    if (!txnDate) {
      errors.push({ line, message: `Unrecognised date "${rawDate.slice(0, 20)}"` });
      continue;
    }
    if (txnDate > today) {
      errors.push({ line, message: `Date ${txnDate} is in the future` });
      continue;
    }

    let direction: "DEBIT" | "CREDIT";
    let amountPaise: bigint;
    if (cols.debit !== undefined && cols.credit !== undefined) {
      const debit = amountCell(get("debit"));
      const credit = amountCell(get("credit"));
      if (debit === null || credit === null) {
        errors.push({ line, message: "Amount is not a valid number" });
        continue;
      }
      if ((debit > 0n) === (credit > 0n)) {
        errors.push({ line, message: debit > 0n ? "Row has both a withdrawal and a deposit" : "Row has no amount" });
        continue;
      }
      [direction, amountPaise] = debit > 0n ? ["DEBIT", debit] : ["CREDIT", credit];
    } else {
      const amount = amountCell(get("amount"));
      const flag = norm(get("drcr"));
      if (amount === null || amount <= 0n) {
        errors.push({ line, message: "Amount is missing or not a valid number" });
        continue;
      }
      if (!["dr", "d", "debit", "cr", "c", "credit"].includes(flag)) {
        errors.push({ line, message: `Unknown Dr/Cr value "${get("drcr").slice(0, 10)}"` });
        continue;
      }
      direction = flag.startsWith("d") ? "DEBIT" : "CREDIT";
      amountPaise = amount;
    }
    if (amountPaise > MAX_AMOUNT_PAISE) {
      errors.push({ line, message: "Amount is larger than ₹10 crore" });
      continue;
    }

    const narration = get("narration");
    const info = parseNarration(narration);
    const bankRef = get("reference").replace(/^0+/, "");
    const reference = info.reference ?? (bankRef && /\d/.test(bankRef) ? bankRef : null);

    // Idempotency key. Same statement imported again -> same fingerprints ->
    // nothing inserted. The occurrence counter keeps two genuinely identical
    // rows in one file (same day, amount and text, no reference) distinct.
    const key = reference ?? narration.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const base = [accountId, txnDate, direction, amountPaise.toString(), key].join("|");
    const occurrence = (keyCounts.get(base) ?? 0) + 1;
    keyCounts.set(base, occurrence);
    const fingerprint = "stmt:" + createHash("sha256").update(`${base}#${occurrence}`).digest("hex");

    rows.push({
      line,
      txnDate,
      direction,
      amountPaise,
      balancePaise: balanceCell(get("balance")),
      channel: info.channel,
      description: describe(info, narration),
      merchant: info.counterparty,
      reference,
      fingerprint,
    });
  }

  const dates = rows.map((r) => r.txnDate).sort();
  return {
    ok: true,
    headerLine: headerIndex + 1,
    rows,
    errors,
    balance: checkRunningBalance(rows),
    period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
  };
}

/**
 * Bank-reconciliation check inside the statement itself: each row's closing
 * balance must equal the previous balance + credit - debit. Statements may be
 * oldest-first or newest-first, so whichever order fits better is used.
 * A mismatch means a missing row, a misread amount or a tampered file.
 */
export function checkRunningBalance(rows: StatementRow[]): BalanceCheck {
  const withBalance = rows.filter((r) => r.balancePaise !== null);
  if (withBalance.length < 2 || withBalance.length !== rows.length) return { status: "unavailable" };

  const run = (ordered: StatementRow[]) => {
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1].balancePaise!;
      const r = ordered[i];
      const expected = r.direction === "CREDIT" ? prev + r.amountPaise : prev - r.amountPaise;
      if (expected !== r.balancePaise) return r.line;
    }
    return null;
  };

  const forward = run(rows);
  if (forward === null) return { status: "ok", checked: rows.length - 1 };
  const backward = run([...rows].reverse());
  if (backward === null) return { status: "ok", checked: rows.length - 1 };
  return { status: "mismatch", checked: rows.length - 1, firstBadLine: forward };
}
