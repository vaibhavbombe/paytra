// Rules-first categorisation (the LLM only gets the leftovers, in Phase 7).
//
// A rule says: "when the merchant/description matches PATTERN (and the
// direction matches, if set), use CATEGORY". Pure functions, no I/O.

export type Direction = "DEBIT" | "CREDIT";
export type CategoryKind = "EXPENSE" | "INCOME" | "TRANSFER";
export type MatchType = "EXACT" | "CONTAINS";

export type Rule = {
  id: string;
  userId: string | null; // null = built-in rule shared by everyone
  pattern: string; // already normalised (see normaliseKey)
  matchType: MatchType;
  direction: Direction | null; // null = either direction
  categoryId: string;
  categoryKind: CategoryKind;
};

export type Categorisable = {
  direction: Direction;
  merchant: string | null;
  description: string;
};

/**
 * "UPI-Swiggy Instamart*Order#42" -> "UPI SWIGGY INSTAMART ORDER 42".
 * Uppercase letters/digits separated by single spaces, so patterns are
 * compared on whole words.
 */
export function normaliseKey(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** The text rules match against: the payee if we parsed one, else the description. */
export function matchText(t: Categorisable): string {
  return normaliseKey(t.merchant ?? t.description);
}

/** A debit can be an expense or a transfer out; a credit income or a transfer in. */
export function kindFitsDirection(kind: CategoryKind, direction: Direction): boolean {
  if (kind === "TRANSFER") return true;
  return direction === "DEBIT" ? kind === "EXPENSE" : kind === "INCOME";
}

function matches(rule: Rule, text: string): boolean {
  if (!rule.pattern) return false;
  if (rule.matchType === "EXACT") return text === rule.pattern;
  // Whole words only: "OLA" must not match "COLA", "VI" not "VIJAY".
  return ` ${text} `.includes(` ${rule.pattern} `);
}

/**
 * Most specific rule wins:
 *  1. the user's own rules before built-in ones,
 *  2. EXACT before CONTAINS,
 *  3. direction-specific before "either direction",
 *  4. longer pattern before shorter ("SWIGGY INSTAMART" beats "SWIGGY").
 */
export function compareRules(a: Rule, b: Rule): number {
  return (
    Number(a.userId === null) - Number(b.userId === null) ||
    Number(a.matchType === "CONTAINS") - Number(b.matchType === "CONTAINS") ||
    Number(a.direction === null) - Number(b.direction === null) ||
    b.pattern.length - a.pattern.length ||
    a.pattern.localeCompare(b.pattern)
  );
}

/** Sort once, then reuse for many transactions (e.g. a whole import). */
export function prepareRules(rules: Rule[]): Rule[] {
  return [...rules].sort(compareRules);
}

/** The winning rule for a transaction, or null. `rules` must be prepared. */
export function categorise(t: Categorisable, rules: Rule[]): Rule | null {
  const text = matchText(t);
  if (!text) return null;
  for (const rule of rules) {
    if (rule.direction && rule.direction !== t.direction) continue;
    if (!kindFitsDirection(rule.categoryKind, t.direction)) continue;
    if (matches(rule, text)) return rule;
  }
  return null;
}
