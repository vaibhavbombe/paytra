// Budget maths. Totals come from SQL over BIGINT paise; the rest is integer
// (BigInt) arithmetic. No floats, and never an LLM.

/**
 * Spend for every active budget of one user, in ONE query.
 *
 * "Spent" = money out minus refunds, in the budget's scope:
 *  - category budget: that category (a credit in it is a refund);
 *  - overall budget: every EXPENSE category plus uncategorised money out.
 *    Transfers/investments never count; uncategorised money IN never counts
 *    (it might be salary).
 * Weekly budgets use the current Monday-Sunday week, monthly ones the
 * calendar month (IST dates, half-open ranges).
 *
 * Params: $1 user id, $2/$3 week [start, end), $4/$5 month [start, end).
 */
export const BUDGET_SPEND_SQL = `
SELECT b.id AS "budgetId",
       GREATEST(s.spent, 0)::bigint::text AS "spentPaise"
FROM budgets b
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(CASE WHEN t.direction = 'DEBIT' THEN t.amount_paise ELSE -t.amount_paise END), 0) AS spent
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.user_id = b.user_id
    AND t.txn_date >= (CASE WHEN b.period = 'WEEKLY' THEN $2 ELSE $4 END)::date
    AND t.txn_date <  (CASE WHEN b.period = 'WEEKLY' THEN $3 ELSE $5 END)::date
    AND CASE
          WHEN b.category_id IS NOT NULL THEN t.category_id = b.category_id
          ELSE c.kind = 'EXPENSE' OR (t.category_id IS NULL AND t.direction = 'DEBIT')
        END
) s
WHERE b.user_id = $1::uuid AND b.active
`;

/** Floor of spent / limit as a whole percent, in integer maths. */
export function percentUsed(spentPaise: bigint, limitPaise: bigint): number {
  if (limitPaise <= 0n) return 0;
  return Number((spentPaise * 100n) / limitPaise);
}

/** Thresholds (e.g. [80, 100]) that this spend has reached, ascending. */
export function thresholdsReached(spentPaise: bigint, limitPaise: bigint, thresholds: number[]): number[] {
  return [...new Set(thresholds)]
    .filter((p) => spentPaise * 100n >= limitPaise * BigInt(p))
    .sort((a, b) => a - b);
}

export type BudgetLevel = "ok" | "warning" | "over";

/** Colour band: amber from the first alert threshold, red at 100%. */
export function budgetLevel(spentPaise: bigint, limitPaise: bigint, thresholds: number[]): BudgetLevel {
  if (spentPaise * 100n >= limitPaise * 100n) return "over";
  const first = Math.min(...thresholds.filter((t) => t < 100), 100);
  return spentPaise * 100n >= limitPaise * BigInt(first) ? "warning" : "ok";
}
