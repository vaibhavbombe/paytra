import { describe, expect, it } from "vitest";

import { dateOnlyToDb, dbDateToIso, isoDateIST } from "./dates";

describe("isoDateIST", () => {
  it("is already the next day in India at 18:30 UTC", () => {
    expect(isoDateIST(new Date("2026-10-11T18:29:59Z"))).toBe("2026-10-11");
    expect(isoDateIST(new Date("2026-10-11T18:30:00Z"))).toBe("2026-10-12");
  });

  it("handles month and year boundaries", () => {
    expect(isoDateIST(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01-01");
    expect(isoDateIST(new Date("2026-02-28T20:00:00Z"))).toBe("2026-03-01");
  });
});

describe("DATE column round-trip", () => {
  it("keeps the same calendar day", () => {
    for (const d of ["2026-01-01", "2026-10-11", "2028-02-29", "2026-12-31"]) {
      expect(dbDateToIso(dateOnlyToDb(d))).toBe(d);
    }
  });
});
