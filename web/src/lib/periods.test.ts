import { describe, expect, it } from "vitest";

import { periodRange } from "./periods";

describe("periodRange: day", () => {
  it("is a single calendar day, half-open", () => {
    expect(periodRange("day", "2026-10-11")).toMatchObject({
      start: "2026-10-11",
      end: "2026-10-12",
      prev: "2026-10-10",
      next: "2026-10-12",
    });
  });

  it("crosses month and year ends", () => {
    expect(periodRange("day", "2026-12-31")).toMatchObject({ end: "2027-01-01", next: "2027-01-01" });
    expect(periodRange("day", "2026-03-01")).toMatchObject({ prev: "2026-02-28" });
    expect(periodRange("day", "2028-03-01")).toMatchObject({ prev: "2028-02-29" }); // leap year
  });
});

describe("periodRange: week (Monday-Sunday)", () => {
  it("starts on Monday for every day of the week", () => {
    // 2026-10-05 is a Monday, 2026-10-11 a Sunday
    for (const d of ["2026-10-05", "2026-10-08", "2026-10-11"]) {
      expect(periodRange("week", d)).toMatchObject({ start: "2026-10-05", end: "2026-10-12" });
    }
    expect(periodRange("week", "2026-10-12")).toMatchObject({ start: "2026-10-12" });
  });

  it("spans a year boundary", () => {
    // 2026-12-31 is a Thursday -> week Mon 2026-12-28 .. Sun 2027-01-03
    const w = periodRange("week", "2026-12-31");
    expect(w).toMatchObject({ start: "2026-12-28", end: "2027-01-04", prev: "2026-12-21", next: "2027-01-04" });
    expect(w.label).toContain("2026");
    expect(w.label).toContain("2027");
  });
});

describe("periodRange: month", () => {
  it("covers the whole month whatever the anchor day", () => {
    for (const d of ["2026-10-01", "2026-10-15", "2026-10-31"]) {
      expect(periodRange("month", d)).toMatchObject({ start: "2026-10-01", end: "2026-11-01" });
    }
  });

  it("does not overflow from the 31st into the month after next", () => {
    expect(periodRange("month", "2026-01-31")).toMatchObject({ next: "2026-02-01", end: "2026-02-01" });
    expect(periodRange("month", "2026-03-31")).toMatchObject({ prev: "2026-02-01" });
  });

  it("handles February in leap and normal years", () => {
    expect(periodRange("month", "2028-02-10")).toMatchObject({ start: "2028-02-01", end: "2028-03-01" });
    expect(periodRange("month", "2026-02-10")).toMatchObject({ end: "2026-03-01" });
  });

  it("rolls the year in December and January", () => {
    expect(periodRange("month", "2026-12-15")).toMatchObject({ end: "2027-01-01", next: "2027-01-01" });
    expect(periodRange("month", "2026-01-15")).toMatchObject({ prev: "2025-12-01" });
  });

  it("labels the month", () => {
    expect(periodRange("month", "2026-10-11").label).toBe("October 2026");
  });
});

describe("periodRange: year", () => {
  it("is the calendar year", () => {
    expect(periodRange("year", "2026-10-11")).toMatchObject({
      start: "2026-01-01",
      end: "2027-01-01",
      label: "2026",
      prev: "2025-01-01",
      next: "2027-01-01",
    });
  });
});
