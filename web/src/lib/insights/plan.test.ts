import { describe, expect, it } from "vitest";

import { byCategoryAnswer, topPayeesAnswer, totalAnswer, transactionsAnswer, trendAnswer } from "./answer";
import { checkPlan } from "./plan";

const TODAY = "2026-10-14";
const CATS = ["Food & Dining", "Transport"];

describe("checkPlan (the web app re-checks the AI's plan)", () => {
  it("turns an inclusive end date into an exclusive SQL end", () => {
    const p = checkPlan({ tool: "total", from_date: "2026-09-01", to_date: "2026-09-30", category: "Food & Dining" }, TODAY, CATS);
    expect(p).toMatchObject({ tool: "total", start: "2026-09-01", end: "2026-10-01", lastDay: "2026-09-30", category: "Food & Dining" });
  });

  it("clamps the end to today and rejects future-only periods", () => {
    expect(checkPlan({ tool: "total", from_date: "2026-10-01", to_date: "2026-12-31" }, TODAY, CATS)).toMatchObject({ lastDay: TODAY, end: "2026-10-15" });
    expect(checkPlan({ tool: "total", from_date: "2026-11-01", to_date: "2026-11-30" }, TODAY, CATS).tool).toBe("unsupported");
  });

  it("rejects categories the user doesn't have, bad dates, unknown tools and over-long periods", () => {
    for (const raw of [
      { tool: "total", from_date: "2026-09-01", to_date: "2026-09-30", category: "Lottery" },
      { tool: "total", from_date: "2026-02-30", to_date: "2026-03-01" },
      { tool: "drop_everything", from_date: "2026-09-01", to_date: "2026-09-30" },
      { tool: "total", from_date: "2015-01-01", to_date: "2026-09-30" },
      { tool: "transactions", from_date: "2026-09-01", to_date: "2026-09-30", limit: 1000 },
      "nonsense",
      null,
    ]) {
      expect(checkPlan(raw, TODAY, CATS).tool).toBe("unsupported");
    }
  });

  it("passes on the AI's own polite refusal", () => {
    expect(checkPlan({ tool: "unsupported", reason: "I can't give investment advice." }, TODAY, CATS)).toEqual({
      tool: "unsupported",
      reason: "I can't give investment advice.",
    });
  });

  it("drops filters that don't apply to the tool", () => {
    const p = checkPlan({ tool: "by_category", from_date: "2026-09-01", to_date: "2026-09-30", category: "Transport", payee: "Uber" }, TODAY, CATS);
    expect(p).toMatchObject({ category: null, payee: null });
  });
});

const SEP = checkPlan({ tool: "total", from_date: "2026-09-01", to_date: "2026-09-30" }, TODAY, CATS);
if (SEP.tool === "unsupported") throw new Error("fixture");

describe("answers are written from SQL numbers", () => {
  it("total", () => {
    expect(totalAnswer(SEP, { spend: "154000", income: "5000000", count: 7 }).headline).toBe(
      "You spent ₹1,540.00 and received ₹50,000.00 (7 transactions).",
    );
    expect(totalAnswer({ ...SEP, category: "Food & Dining" }, { spend: "120000", income: "0", count: 1 }).headline).toBe(
      "You spent ₹1,200.00 on Food & Dining (1 transaction).",
    );
    expect(totalAnswer({ ...SEP, payee: "swiggy" }, { spend: "0", income: "0", count: 0 }).headline).toBe(
      'No transactions found at "swiggy" for 1 Sept 2026 to 30 Sept 2026.',
    );
  });

  it("shows how the question was read", () => {
    expect(totalAnswer({ ...SEP, category: "Food & Dining" }, { spend: "1", income: "0", count: 1 }).interpretation).toEqual([
      "Period: 1 Sept 2026 to 30 Sept 2026",
      "Category: Food & Dining",
    ]);
  });

  it("by category with integer shares", () => {
    const a = byCategoryAnswer(SEP, [
      { name: "Food & Dining", spend: "120000" },
      { name: "Transport", spend: "25000" },
      { name: "Uncategorised", spend: "9000" },
    ]);
    expect(a.headline).toBe("You spent ₹1,540.00 in total; the biggest category was Food & Dining at ₹1,200.00 (77%).");
    expect(a.table?.rows[1]).toEqual(["Transport", "₹250.00", "16%"]);
  });

  it("trend names the peak", () => {
    const a = trendAnswer({ ...SEP, granularity: "month" }, [
      { bucket: "2026-08-01", spend: "0" },
      { bucket: "2026-09-01", spend: "120000" },
    ]);
    expect(a.headline).toBe("You spent ₹1,200.00 over this period; the highest month was Sept 2026 at ₹1,200.00.");
  });

  it("top payees and transactions", () => {
    expect(topPayeesAnswer({ ...SEP, limit: 2 }, [{ payee: "Zomato", count: 1, total: "60000" }]).headline).toBe(
      "You paid Zomato the most: ₹600.00 across 1 payment.",
    );
    const t = transactionsAnswer(SEP, [
      { date: "2026-09-12", payee: "SWIGGY INSTAMART", direction: "DEBIT", amount: "30000", category: "Food & Dining", matched: 3 },
      { date: "2026-09-11", payee: "Swiggy", direction: "CREDIT", amount: "10000", category: "Food & Dining", matched: 3 },
    ]);
    expect(t.headline).toBe("3 transactions match; showing the latest 2.");
    expect(t.table?.rows[1]).toEqual(["11 Sept 2026", "Swiggy", "Food & Dining", "+₹100.00"]);
  });

  it("empty results say so instead of showing ₹0 tables", () => {
    expect(byCategoryAnswer(SEP, []).table).toBeNull();
    expect(trendAnswer(SEP, [{ bucket: "2026-09-01", spend: "0" }]).headline).toMatch(/^No spending found/);
  });
});
