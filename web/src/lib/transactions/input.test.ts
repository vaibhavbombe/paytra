import { describe, expect, it } from "vitest";

import { categoryFitsDirection, parseManualTransaction } from "./input";

// 2026-10-11 20:00 IST
const NOW = new Date("2026-10-11T14:30:00Z");

const valid = {
  requestId: "0199d3a2-7c41-7b3e-9a10-5d2f4e6b8c01",
  accountId: "0199d3a2-7c41-7b3e-9a10-5d2f4e6b8c02",
  direction: "DEBIT",
  amount: "₹1,499.50",
  txnDate: "2026-10-11",
  description: "  Swiggy dinner  ",
  categoryId: "",
  notes: "",
};

describe("parseManualTransaction", () => {
  it("accepts a valid entry and converts the amount to paise", () => {
    const r = parseManualTransaction(valid, NOW);
    expect(r).toEqual({
      ok: true,
      data: {
        requestId: valid.requestId,
        accountId: valid.accountId,
        direction: "DEBIT",
        amountPaise: 149950n,
        txnDate: "2026-10-11",
        description: "Swiggy dinner",
        categoryId: null,
        notes: null,
      },
    });
  });

  it("rejects a bad amount with a field error", () => {
    const r = parseManualTransaction({ ...valid, amount: "12.345" }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.amount).toBeDefined();
  });

  it("rejects a future date (judged in IST)", () => {
    const r = parseManualTransaction({ ...valid, txnDate: "2026-10-12" }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors.txnDate).toMatch(/future/);
  });

  it("allows today in IST even when it is still yesterday in UTC", () => {
    // 2026-10-12 01:00 IST = 2026-10-11 19:30 UTC
    const r = parseManualTransaction(
      { ...valid, txnDate: "2026-10-12" },
      new Date("2026-10-11T19:30:00Z"),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects an impossible date and very old dates", () => {
    expect(parseManualTransaction({ ...valid, txnDate: "2026-02-30" }, NOW).ok).toBe(false);
    expect(parseManualTransaction({ ...valid, txnDate: "1999-12-31" }, NOW).ok).toBe(false);
  });

  it("rejects missing description, bad ids and unknown direction", () => {
    expect(parseManualTransaction({ ...valid, description: "   " }, NOW).ok).toBe(false);
    expect(parseManualTransaction({ ...valid, accountId: "1 OR 1=1" }, NOW).ok).toBe(false);
    expect(parseManualTransaction({ ...valid, requestId: "abc" }, NOW).ok).toBe(false);
    expect(parseManualTransaction({ ...valid, direction: "REFUND" }, NOW).ok).toBe(false);
  });

  it("rejects an over-long description", () => {
    expect(parseManualTransaction({ ...valid, description: "x".repeat(121) }, NOW).ok).toBe(false);
  });
});

describe("categoryFitsDirection", () => {
  it("matches expense to debit and income to credit; transfers either way", () => {
    expect(categoryFitsDirection("EXPENSE", "DEBIT")).toBe(true);
    expect(categoryFitsDirection("EXPENSE", "CREDIT")).toBe(false);
    expect(categoryFitsDirection("INCOME", "CREDIT")).toBe(true);
    expect(categoryFitsDirection("INCOME", "DEBIT")).toBe(false);
    expect(categoryFitsDirection("TRANSFER", "DEBIT")).toBe(true);
    expect(categoryFitsDirection("TRANSFER", "CREDIT")).toBe(true);
  });
});
