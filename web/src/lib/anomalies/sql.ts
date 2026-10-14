// Unusual spending, computed in SQL (no LLM). Two checks, both against the
// user's OWN history, both explainable in one sentence.
//
// Typical = the MEDIAN, not the mean: one big purchase last month shouldn't
// make everything after it look normal. percentile_disc returns an actual
// stored amount (BIGINT paise), so no floating point is involved.

import { SPEND_SQL } from "@/lib/analytics/sql";

export const LARGE = {
  multiple: 3, // at least 3x the typical payment in that category
  minPaise: 50_000, // and at least Rs 500, so small purchases never alert
  minHistory: 5, // need 5 earlier payments in the category to know "typical"
  historyDays: 90,
  lookbackDays: 30, // which payments to check: the last 30 days
} as const;

export const SPIKE = {
  // Month so far > 1.5x a typical month: compared as current*2 > typical*3
  // so the maths stays in integers.
  numerator: 3,
  denominator: 2,
  minExtraPaise: 100_000, // and at least Rs 1,000 above typical
  months: 3, // typical = median of the previous 3 full months (empty months count as 0)
} as const;

/**
 * $1 user, $2 first day to check, $3 day after today, $4 multiple, $5 min
 * paise, $6 min history, $7 history days. Money-out payments in expense
 * categories (or uncategorised), each compared with the median of the
 * same category's payments in the $7 days before it.
 */
export const LARGE_PAYMENTS_SQL = `
WITH spend AS (
  SELECT t.id, t.txn_date, t.amount_paise, t.category_id,
         COALESCE(t.merchant, t.description) AS payee,
         COALESCE(c.name, 'Uncategorised') AS category
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.user_id = $1::uuid AND t.direction = 'DEBIT'
    AND (c.kind = 'EXPENSE' OR t.category_id IS NULL)
)
SELECT s.id, s.txn_date::text AS date, s.payee, s.category,
       s.amount_paise::text AS amount,
       h.typical::text AS typical,
       h.n AS history
FROM spend s
CROSS JOIN LATERAL (
  SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY p.amount_paise) AS typical, COUNT(*)::int AS n
  FROM spend p
  WHERE p.category_id IS NOT DISTINCT FROM s.category_id
    AND p.txn_date >= s.txn_date - $7::int AND p.txn_date < s.txn_date
) h
WHERE s.txn_date >= $2::date AND s.txn_date < $3::date
  AND h.n >= $6::int
  AND s.amount_paise >= $5::bigint
  AND s.amount_paise >= $4::int * h.typical
ORDER BY s.txn_date DESC, s.amount_paise DESC
LIMIT 10`;

/**
 * $1 user, $2 first day of this month, $3 day after today, $4 months of
 * history, $5 numerator, $6 denominator, $7 min extra paise. Categories
 * whose spend so far this month is well above a typical month.
 */
export const CATEGORY_SPIKES_SQL = `
WITH monthly AS (
  SELECT COALESCE(c.name, 'Uncategorised') AS name,
         date_trunc('month', t.txn_date)::date AS m,
         SUM(${SPEND_SQL}) AS spend
  FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.user_id = $1::uuid
    AND t.txn_date >= ($2::date - make_interval(months => $4::int))::date
    AND t.txn_date < $3::date
  GROUP BY 1, 2
),
cur AS (SELECT name, spend FROM monthly WHERE m = $2::date AND spend > 0),
prev AS (
  SELECT generate_series($2::date - make_interval(months => $4::int), $2::date - interval '1 month', interval '1 month')::date AS m
),
hist AS (
  SELECT cur.name, COALESCE(monthly.spend, 0) AS spend
  FROM cur CROSS JOIN prev
  LEFT JOIN monthly ON monthly.name = cur.name AND monthly.m = prev.m
),
typical AS (
  SELECT name, percentile_disc(0.5) WITHIN GROUP (ORDER BY spend) AS spend FROM hist GROUP BY name
)
SELECT cur.name, cur.spend::bigint::text AS current, typical.spend::bigint::text AS typical
FROM cur JOIN typical USING (name)
WHERE typical.spend > 0
  AND cur.spend * $6::int > typical.spend * $5::int
  AND cur.spend - typical.spend >= $7::bigint
ORDER BY cur.spend - typical.spend DESC`;
