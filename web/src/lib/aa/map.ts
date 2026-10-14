// Account Aggregator data -> the SAME table shape as a bank statement CSV, so
// it goes through the same parser as CSV/PDF imports: identical fingerprints
// (no duplicates across AA / statement / PDF), the same running-balance check,
// the same narration parsing (payee, UPI RRN) and the same category rules.
// Pure, no I/O.

import { isoDateIST } from "@/lib/dates";
import { parseStatementTable, type ParsedStatement } from "@/lib/imports/statement";

import type { AaTransaction } from "./setu";

const HEADER = ["Date", "Narration", "Chq./Ref.No.", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"];

/** Last 4 digits from an AA masked number like "XXXXXX4373" (null if not 4 digits). */
export function last4FromMasked(masked: string | null | undefined): string | null {
  const m = masked?.match(/(\d{4})\s*$/);
  return m ? m[1] : null;
}

/** "2026-10-02" (value date) or the IST calendar day of the timestamp. */
function txnDay(t: AaTransaction): string | null {
  if (t.valueDate && /^\d{4}-\d{2}-\d{2}/.test(t.valueDate)) return t.valueDate.slice(0, 10);
  if (t.transactionTimestamp) {
    const d = new Date(t.transactionTimestamp);
    if (!Number.isNaN(d.getTime())) return isoDateIST(d);
  }
  return null;
}

const decimal = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : String(v));

/** Build the statement table, oldest first (as banks print them). */
export function aaTransactionsToTable(txns: AaTransaction[]): string[][] {
  const sorted = [...txns].sort((a, b) =>
    (a.transactionTimestamp ?? a.valueDate ?? "").localeCompare(b.transactionTimestamp ?? b.valueDate ?? ""),
  );
  const rows = sorted.map((t) => {
    const debit = /^d/i.test(t.type); // DEBIT / CREDIT
    return [
      txnDay(t) ?? "", // empty date -> parser reports it as a row error
      t.narration ?? "",
      t.reference ?? "",
      debit ? decimal(t.amount) : "",
      debit ? "" : decimal(t.amount),
      decimal(t.currentBalance),
    ];
  });
  return [HEADER, ...rows];
}

export function parseAaAccount(txns: AaTransaction[], accountId: string, today: string): ParsedStatement {
  return parseStatementTable(aaTransactionsToTable(txns), accountId, today);
}

/** "setu-fip-2" -> "Setu FIP 2 (sandbox)": display name for an auto-created account. */
export function fipDisplayName(fipId: string | null | undefined): string {
  if (!fipId) return "Bank (via Account Aggregator)";
  const words = fipId.replace(/[-_]+/g, " ").trim().split(" ");
  return `${words.map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ")} (sandbox)`;
}
