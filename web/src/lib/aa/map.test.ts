import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseStatement } from "@/lib/imports/statement";

import { aaTransactionsToTable, fipDisplayName, last4FromMasked, parseAaAccount } from "./map";
import type { AaTransaction } from "./setu";

const ACC = "0199d3a2-7c41-7b3e-9a10-5d2f4e6b8c01";
const TODAY = "2026-10-12";

// MOCK AA transactions mirroring the mock HDFC CSV fixture's first rows.
const aa: AaTransaction[] = [
  { type: "DEBIT", mode: "UPI", amount: "450.00", currentBalance: "109550.00", transactionTimestamp: "2026-10-02T10:15:00+05:30", valueDate: "2026-10-02", txnId: "T2", narration: "UPI-SWIGGY-swiggy8@ybl-YESB0YBLUPI-428512345678-Payment from Phone", reference: "0000428512345678" },
  { type: "CREDIT", mode: "NEFT", amount: 85000, currentBalance: "110000.00", transactionTimestamp: "2026-10-01T09:00:00+05:30", valueDate: "2026-10-01", txnId: "T1", narration: "NEFT CR-SBIN0001234-ACME TECHNOLOGIES PVT LTD-VAIBHAV-SBIN226123456789", reference: "SBIN226123456789" },
  { type: "DEBIT", mode: "OTHERS", amount: "12500.00", currentBalance: "97050.00", transactionTimestamp: "2026-10-03T08:00:00+05:30", valueDate: "2026-10-03", txnId: "T3", narration: "ACH D- BAJAJ FINANCE LTD-ABCD1234567", reference: "0000000000000000" },
];

describe("AA -> statement table", () => {
  it("sorts oldest first and splits debit/credit columns", () => {
    const t = aaTransactionsToTable(aa);
    expect(t[0]).toEqual(["Date", "Narration", "Chq./Ref.No.", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"]);
    expect(t.slice(1).map((r) => [r[0], r[3], r[4]])).toEqual([
      ["2026-10-01", "", "85000"],
      ["2026-10-02", "450.00", ""],
      ["2026-10-03", "12500.00", ""],
    ]);
  });

  it("parses with the statement parser: exact paise, payees, balance check", () => {
    const r = parseAaAccount(aa, ACC, TODAY);
    if (!r.ok) throw new Error(r.error);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.direction, x.amountPaise, x.description])).toEqual([
      ["CREDIT", 8500000n, "Acme Technologies Pvt Ltd"],
      ["DEBIT", 45000n, "Swiggy"],
      ["DEBIT", 1250000n, "Bajaj Finance Ltd"],
    ]);
    expect(r.balance).toEqual({ status: "ok", checked: 2 });
  });

  it("gives the SAME fingerprints as the bank's CSV for the same payments (no cross-source duplicates)", () => {
    const csv = parseStatement(readFileSync(join(__dirname, "..", "imports", "__fixtures__", "hdfc-style-mock.csv"), "utf8"), ACC, TODAY);
    if (!csv.ok) throw new Error(csv.error);
    const viaAa = parseAaAccount(aa, ACC, TODAY);
    if (!viaAa.ok) throw new Error(viaAa.error);
    const csvFps = new Set(csv.rows.map((x) => x.fingerprint));
    expect(viaAa.rows.every((x) => csvFps.has(x.fingerprint))).toBe(true);
  });

  it("uses the IST day of the timestamp when there's no value date", () => {
    const r = parseAaAccount([{ type: "DEBIT", amount: "10.00", transactionTimestamp: "2026-10-04T20:00:00Z", narration: "x" }], ACC, TODAY);
    if (!r.ok) throw new Error(r.error);
    expect(r.rows[0].txnDate).toBe("2026-10-05"); // 01:30 IST next day
  });

  it("reports a row without any date instead of guessing", () => {
    const r = parseAaAccount([{ type: "DEBIT", amount: "10.00", narration: "x" }], ACC, TODAY);
    if (!r.ok) throw new Error(r.error);
    expect(r.rows).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("last4FromMasked", () => {
    expect(last4FromMasked("XXXXXX4373")).toBe("4373");
    expect(last4FromMasked("XX12")).toBeNull();
    expect(last4FromMasked(null)).toBeNull();
  });
  it("fipDisplayName", () => {
    expect(fipDisplayName("setu-fip-2")).toBe("Setu FIP 2 (sandbox)");
    expect(fipDisplayName(null)).toBe("Bank (via Account Aggregator)");
  });
});
