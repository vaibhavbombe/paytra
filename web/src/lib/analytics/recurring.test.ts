import { describe, expect, it } from "vitest";

import { detectRecurring, type Payment } from "./recurring";

const TODAY = "2026-10-13";
const p = (payee: string, date: string, rupees: number, category: string | null = null): Payment => ({
  payee,
  date,
  amountPaise: BigInt(Math.round(rupees * 100)),
  category,
});

const find = (list: ReturnType<typeof detectRecurring>, payee: string) => list.find((r) => r.payee === payee);

describe("detectRecurring", () => {
  const history: Payment[] = [
    // Netflix: same amount, ~monthly on the 5th
    ...["2026-05-05", "2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"].map((d) => p("Netflix", d, 649, "Subscriptions")),
    // Rent via IMPS, a couple of days' jitter
    p("Priya Nair", "2026-07-01", 18000), p("Priya Nair", "2026-08-03", 18000), p("Priya Nair", "2026-09-01", 18000), p("Priya Nair", "2026-10-02", 18000),
    // Milk, weekly, small amount variation (within 15%)
    ...["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22", "2026-09-29", "2026-10-06"].map((d, i) => p("Milkbasket", d, 300 + (i % 2) * 20)),
    // Swiggy: frequent but irregular amounts and gaps -> NOT recurring
    p("Swiggy", "2026-09-02", 450), p("Swiggy", "2026-09-04", 1200), p("Swiggy", "2026-09-19", 230), p("Swiggy", "2026-10-01", 890), p("Swiggy", "2026-10-10", 310),
    // EMI with one skipped month (one 61-day gap among monthly ones)
    p("Bajaj Finance Ltd", "2026-04-03", 12500), p("Bajaj Finance Ltd", "2026-05-03", 12500), p("Bajaj Finance Ltd", "2026-06-03", 12500),
    p("Bajaj Finance Ltd", "2026-08-03", 12500), p("Bajaj Finance Ltd", "2026-09-03", 12500), p("Bajaj Finance Ltd", "2026-10-03", 12500),
    // Yearly insurance
    p("LIC", "2025-03-10", 24000), p("LIC", "2026-03-11", 24000),
    // A subscription that stopped in June
    p("Spotify", "2026-03-20", 119), p("Spotify", "2026-04-20", 119), p("Spotify", "2026-05-20", 119), p("Spotify", "2026-06-20", 119),
  ];
  const found = detectRecurring(history, TODAY);

  it("detects a fixed monthly subscription and predicts the next date", () => {
    expect(find(found, "Netflix")).toMatchObject({
      cadence: "monthly",
      count: 6,
      typicalPaise: 64900n,
      fixedAmount: true,
      lastDate: "2026-10-05",
      nextDate: "2026-11-05",
      active: true,
      category: "Subscriptions",
    });
  });

  it("tolerates a few days of jitter (rent)", () => {
    expect(find(found, "Priya Nair")).toMatchObject({ cadence: "monthly", typicalPaise: 1800000n, nextDate: "2026-11-02" });
  });

  it("detects weekly payments with small amount changes", () => {
    expect(find(found, "Milkbasket")).toMatchObject({ cadence: "weekly", fixedAmount: false, nextDate: "2026-10-13" });
  });

  it("still detects an EMI with one skipped month", () => {
    expect(find(found, "Bajaj Finance Ltd")).toMatchObject({ cadence: "monthly", count: 6 });
  });

  it("detects yearly payments from two occurrences", () => {
    expect(find(found, "LIC")).toMatchObject({ cadence: "yearly", nextDate: "2027-03-11", active: true });
  });

  it("marks a subscription that stopped as inactive", () => {
    expect(find(found, "Spotify")).toMatchObject({ cadence: "monthly", active: false });
  });

  it("ignores frequent but irregular spending", () => {
    expect(find(found, "Swiggy")).toBeUndefined();
  });

  it("computes a monthly-equivalent cost in integer paise", () => {
    expect(find(found, "Netflix")!.monthlyPaise).toBe((64900n * 365n) / (12n * 30n));
    expect(find(found, "LIC")!.monthlyPaise).toBe(200000n); // ₹24,000 / 12 = ₹2,000
  });

  it("lists active ones first, most expensive first", () => {
    const active = found.filter((r) => r.active).map((r) => r.payee);
    expect(active[0]).toBe("Priya Nair");
    expect(found.at(-1)!.payee).toBe("Spotify");
  });

  it("clamps month-end dates (31 Jan -> 28 Feb)", () => {
    const r = detectRecurring(
      ["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"].map((d) => p("Gym", d, 1500)),
      "2027-02-01",
    );
    expect(r[0]).toMatchObject({ cadence: "monthly", nextDate: "2027-02-28" });
  });
});
