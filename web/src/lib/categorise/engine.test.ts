import { describe, expect, it } from "vitest";

import { categorise, normaliseKey, prepareRules, type Rule } from "./engine";

let n = 0;
const rule = (p: Partial<Rule> & Pick<Rule, "pattern" | "categoryId">): Rule => ({
  id: `r${++n}`,
  userId: null,
  matchType: "CONTAINS",
  direction: null,
  categoryKind: "EXPENSE",
  ...p,
  pattern: normaliseKey(p.pattern),
});
const debit = (merchant: string | null, description = merchant ?? "") => ({ direction: "DEBIT" as const, merchant, description });
const credit = (merchant: string | null, description = merchant ?? "") => ({ direction: "CREDIT" as const, merchant, description });

describe("normaliseKey", () => {
  it("uppercases and keeps whole words", () => {
    expect(normaliseKey("UPI-Swiggy Instamart*Order#42")).toBe("UPI SWIGGY INSTAMART ORDER 42");
    expect(normaliseKey("  bigbasket@icici  ")).toBe("BIGBASKET ICICI");
    expect(normaliseKey("₹—")).toBe("");
  });
});

describe("categorise", () => {
  const rules = prepareRules([
    rule({ pattern: "swiggy", categoryId: "food" }),
    rule({ pattern: "swiggy instamart", categoryId: "groceries" }),
    rule({ pattern: "ola", categoryId: "transport" }),
    rule({ pattern: "vi", categoryId: "mobile" }),
    rule({ pattern: "salary", categoryId: "salary", categoryKind: "INCOME", direction: "CREDIT" }),
    rule({ pattern: "refund", categoryId: "refunds", categoryKind: "INCOME" }),
    rule({ pattern: "zerodha", categoryId: "investments", categoryKind: "TRANSFER" }),
  ]);
  const cat = (t: Parameters<typeof categorise>[0]) => categorise(t, rules)?.categoryId ?? null;

  it("matches on whole words", () => {
    expect(cat(debit("Swiggy"))).toBe("food");
    expect(cat(debit("Ola Cabs"))).toBe("transport");
    expect(cat(debit("Coca Cola"))).toBeNull(); // not OLA
    expect(cat(debit("Vijay Stores"))).toBeNull(); // not VI
    expect(cat(debit("VI Postpaid"))).toBe("mobile");
  });

  it("prefers the longer, more specific pattern", () => {
    expect(cat(debit("Swiggy Instamart"))).toBe("groceries");
  });

  it("respects direction and category kind", () => {
    const incomeRule = prepareRules([rule({ pattern: "bonus", categoryId: "bonus", categoryKind: "INCOME" })]);
    expect(categorise(debit("Bonus payout"), incomeRule)).toBeNull(); // money out can't be income
    expect(cat(credit("ACME SALARY OCT"))).toBe("salary");
    expect(cat(debit("SALARY ADVANCE REPAY"))).toBeNull(); // rule is credit-only
    expect(cat(credit("Swiggy"))).toBe("food"); // money in under an expense = a refund of it
    expect(cat(credit("Swiggy refund"))).toBe("refunds");
    expect(cat(debit("Zerodha"))).toBe("investments"); // transfers fit both directions
  });

  it("uses the description when there is no merchant", () => {
    expect(cat(debit(null, "POS AMAZON SWIGGY"))).toBe("food");
  });

  it("the user's own rule beats a built-in one, even if shorter", () => {
    const withUser = prepareRules([
      ...rules,
      rule({ pattern: "swiggy", categoryId: "work-meals", userId: "u1", matchType: "EXACT" }),
    ]);
    expect(categorise(debit("Swiggy"), withUser)?.categoryId).toBe("work-meals");
    // EXACT only: "Swiggy Instamart" still goes to the built-in groceries rule.
    expect(categorise(debit("Swiggy Instamart"), withUser)?.categoryId).toBe("groceries");
  });

  it("returns null when nothing matches or text is empty", () => {
    expect(cat(debit("Ramesh Kirana"))).toBeNull();
    expect(cat(debit(null, "---"))).toBeNull();
  });
});
