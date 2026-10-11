import { describe, expect, it } from "vitest";

import { formatPaise, MAX_AMOUNT_PAISE, parseRupeesToPaise } from "./money";

function paise(input: string) {
  const r = parseRupeesToPaise(input);
  if (!r.ok) throw new Error(`expected ok for "${input}", got: ${r.error}`);
  return r.paise;
}

function rejects(input: string) {
  expect(parseRupeesToPaise(input).ok, `"${input}" should be rejected`).toBe(false);
}

describe("parseRupeesToPaise", () => {
  it("parses whole rupees", () => {
    expect(paise("499")).toBe(49900n);
    expect(paise("1")).toBe(100n);
  });

  it("parses one and two decimals", () => {
    expect(paise("499.5")).toBe(49950n);
    expect(paise("499.50")).toBe(49950n);
    expect(paise("499.05")).toBe(49905n);
    expect(paise("0.01")).toBe(1n);
  });

  it("has no floating-point drift on classic problem values", () => {
    // parseFloat(x) * 100 gets these wrong (28.999..., 57.999..., 1004.9999...)
    expect(paise("0.29")).toBe(29n);
    expect(paise("0.58")).toBe(58n);
    expect(paise("10.05")).toBe(1005n);
    expect(paise("1.15")).toBe(115n);
  });

  it("accepts ₹ prefix, Indian and western grouping, surrounding spaces", () => {
    expect(paise("₹1,23,456.78")).toBe(12345678n);
    expect(paise("₹ 499")).toBe(49900n);
    expect(paise("123,456.78")).toBe(12345678n);
    expect(paise("  250  ")).toBe(25000n);
  });

  it("accepts the maximum and rejects one paisa more", () => {
    expect(paise("100000000")).toBe(MAX_AMOUNT_PAISE);
    rejects("100000000.01");
  });

  it("rejects zero, negatives and junk", () => {
    for (const bad of ["0", "0.00", "-5", "+5", "", " ", "abc", "1e3", "12.345", ".5", "5.", "1.2.3", "Infinity", "NaN", "0x10", "١٢٣"]) {
      rejects(bad);
    }
  });
});

describe("formatPaise", () => {
  it("formats with Indian grouping and two decimals", () => {
    expect(formatPaise(12345678n)).toBe("₹1,23,456.78");
    expect(formatPaise(49900n)).toBe("₹499.00");
    expect(formatPaise(5n)).toBe("₹0.05");
    expect(formatPaise(0n)).toBe("₹0.00");
    expect(formatPaise(MAX_AMOUNT_PAISE)).toBe("₹10,00,00,000.00");
  });

  it("formats negatives (used for net totals)", () => {
    expect(formatPaise(-150n)).toBe("-₹1.50");
  });

  it("round-trips with the parser", () => {
    for (const s of ["0.01", "0.29", "499.99", "1,23,456.78", "10,00,00,000.00"]) {
      expect(formatPaise(paise(s))).toBe(`₹${s}`);
    }
  });
});
