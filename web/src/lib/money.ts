// Money helpers. Amounts live in the database as BigInt paise.
// Rupee strings are parsed with string/integer maths only: parseFloat("0.29")
// * 100 = 28.999999999999996, which is exactly the bug this module prevents.

// Largest single amount we accept: ₹10,00,00,000.00 (10 crore). Guards
// against typos and keeps totals far below the BigInt/Postgres BIGINT range.
export const MAX_AMOUNT_PAISE = 10_00_00_000_00n;

const AMOUNT_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

export type ParseResult = { ok: true; paise: bigint } | { ok: false; error: string };

/**
 * "1,23,456.7" -> 12345670n paise.
 * Accepts an optional leading ₹, Indian or western comma grouping, and at
 * most 2 decimals. Rejects negatives (direction carries the sign), zero,
 * exponents, and anything with more than 2 decimals rather than rounding it.
 */
export function parseRupeesToPaise(input: string): ParseResult {
  const cleaned = input.trim().replace(/^₹\s*/, "").replace(/,/g, "");
  const match = AMOUNT_RE.exec(cleaned);
  if (!match) {
    return { ok: false, error: "Enter an amount like 499 or 499.50" };
  }

  const [, rupees, fraction = ""] = match;
  const paise = BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));

  if (paise <= 0n) return { ok: false, error: "Amount must be more than ₹0" };
  if (paise > MAX_AMOUNT_PAISE) return { ok: false, error: "Amount is too large" };
  return { ok: true, paise };
}

const inrGrouping = new Intl.NumberFormat("en-IN");

/** 12345670n -> "₹1,23,456.70" (Indian digit grouping). */
export function formatPaise(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = inrGrouping.format(abs / 100n);
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}₹${rupees}.${fraction}`;
}
