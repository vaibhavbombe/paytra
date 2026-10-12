import { describe, expect, it } from "vitest";

import { listHref, parseListFilters } from "./filters";

const NOW = new Date("2026-10-11T14:30:00Z"); // 20:00 IST
const UUID = "0199d3a2-7c41-7b3e-9a10-5d2f4e6b8c01";

describe("parseListFilters", () => {
  it("defaults to this month, today (IST), no filters", () => {
    expect(parseListFilters({}, NOW)).toEqual({
      period: "month",
      date: "2026-10-11",
      direction: null,
      categoryId: null,
      accountId: null,
      q: null,
      cursor: null,
    });
  });

  it("reads valid params", () => {
    const f = parseListFilters(
      { period: "week", date: "2026-09-02", dir: "DEBIT", cat: UUID, acc: UUID, q: " swiggy ", cursor: UUID },
      NOW,
    );
    expect(f).toEqual({
      period: "week",
      date: "2026-09-02",
      direction: "DEBIT",
      categoryId: UUID,
      accountId: UUID,
      q: "swiggy",
      cursor: UUID,
    });
  });

  it("ignores junk instead of failing", () => {
    const f = parseListFilters(
      { period: "decade", date: "2026-13-45", dir: "SIDEWAYS", cat: "'; drop table--", acc: "x", cursor: "1" },
      NOW,
    );
    expect(f).toMatchObject({ period: "month", date: "2026-10-11", direction: null, categoryId: null, accountId: null, cursor: null });
  });

  it("clamps future and pre-2000 dates to today", () => {
    expect(parseListFilters({ date: "2026-10-12" }, NOW).date).toBe("2026-10-11");
    expect(parseListFilters({ date: "1999-01-01" }, NOW).date).toBe("2026-10-11");
  });

  it("accepts 'none' for uncategorised and takes the first of repeated params", () => {
    expect(parseListFilters({ cat: "none" }, NOW).categoryId).toBe("none");
    expect(parseListFilters({ period: ["year", "day"] }, NOW).period).toBe("year");
  });

  it("drops an over-long search", () => {
    expect(parseListFilters({ q: "x".repeat(61) }, NOW).q).toBeNull();
  });
});

describe("listHref", () => {
  it("round-trips through the parser", () => {
    const href = listHref({ period: "week", date: "2026-10-05", direction: "CREDIT", q: "rent & bills" });
    expect(href).toBe("/transactions?period=week&date=2026-10-05&dir=CREDIT&q=rent+%26+bills");
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(parseListFilters(params, NOW)).toMatchObject({ period: "week", direction: "CREDIT", q: "rent & bills" });
  });

  it("returns the bare path with no filters", () => {
    expect(listHref({})).toBe("/transactions");
  });
});
