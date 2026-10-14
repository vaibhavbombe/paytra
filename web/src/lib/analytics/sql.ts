// Analytics queries. Every number is summed by Postgres over BIGINT paise and
// returned as text (no float rounding, no BigInt-in-JSON issues).
//
// One definition of "spent", shared with budgets:
//   spend  = money out in expense categories or uncategorised,
//            minus refunds (money in under an expense category);
//   income = money in that is income or uncategorised;
//   transfers (self transfers, investments) count as neither.

const FROM = `
FROM transactions t
LEFT JOIN categories c ON c.id = t.category_id
WHERE t.user_id = $1::uuid AND t.txn_date >= $2::date AND t.txn_date < $3::date`;

const SPEND = `
CASE
  WHEN t.direction = 'DEBIT'  AND (c.kind = 'EXPENSE' OR t.category_id IS NULL) THEN t.amount_paise
  WHEN t.direction = 'CREDIT' AND c.kind = 'EXPENSE' THEN -t.amount_paise
  ELSE 0
END`;

const INCOME = `
CASE WHEN t.direction = 'CREDIT' AND (c.kind = 'INCOME' OR t.category_id IS NULL) THEN t.amount_paise ELSE 0 END`;

/** $1 user, $2 start, $3 end (exclusive). One row: spend, income. */
export const TOTALS_SQL = `
SELECT COALESCE(SUM(${SPEND}), 0)::bigint::text AS spend,
       COALESCE(SUM(${INCOME}), 0)::bigint::text AS income,
       COUNT(*)::int AS count
${FROM}`;

export type Bucket = "day" | "week" | "month" | "year";

/**
 * $1 user, $2 start, $3 end (exclusive), $4 bucket ('day'|'week'|'month'|'year').
 * One row per bucket, INCLUDING empty ones (generate_series), so charts show
 * zero days instead of skipping them. Postgres weeks start on Monday,
 * matching our Mon-Sun weeks.
 */
export const TREND_SQL = `
WITH buckets AS (
  SELECT generate_series(
           date_trunc($4::text, $2::date::timestamp),
           ($3::date - 1)::timestamp,
           ('1 ' || $4::text)::interval
         )::date AS b
),
sums AS (
  SELECT date_trunc($4::text, t.txn_date::timestamp)::date AS b,
         SUM(${SPEND}) AS spend,
         SUM(${INCOME}) AS income
  ${FROM}
  GROUP BY 1
)
SELECT buckets.b::text AS bucket,
       COALESCE(sums.spend, 0)::bigint::text AS spend,
       COALESCE(sums.income, 0)::bigint::text AS income
FROM buckets LEFT JOIN sums ON sums.b = buckets.b
ORDER BY buckets.b`;

/** $1 user, $2 start, $3 end. Net spend per category (refunds deducted), largest first. */
export const CATEGORY_SPLIT_SQL = `
SELECT COALESCE(c.name, 'Uncategorised') AS name,
       SUM(${SPEND})::bigint::text AS spend
${FROM}
GROUP BY 1
HAVING SUM(${SPEND}) > 0
ORDER BY SUM(${SPEND}) DESC`;

/** $1 user, $2 start, $3 end, $4 limit. Who you paid most (money out only). */
export const TOP_PAYEES_SQL = `
SELECT COALESCE(t.merchant, t.description) AS payee,
       COUNT(*)::int AS count,
       SUM(t.amount_paise)::bigint::text AS total
${FROM}
  AND t.direction = 'DEBIT' AND (c.kind = 'EXPENSE' OR t.category_id IS NULL)
GROUP BY 1
ORDER BY SUM(t.amount_paise) DESC, 1
LIMIT $4::int`;

/** $1 user, $2 start, $3 end. Money-out rows for recurring-payment detection. */
export const RECURRING_CANDIDATES_SQL = `
SELECT COALESCE(t.merchant, t.description) AS payee,
       t.txn_date::text AS date,
       t.amount_paise::text AS amount,
       c.name AS category
${FROM}
  AND t.direction = 'DEBIT' AND (c.kind IS NULL OR c.kind <> 'TRANSFER' OR c.name = 'Investments')
ORDER BY t.txn_date`;

// Shared with the insights queries, so "spent" means the same everywhere.
export { FROM as TXN_FROM_SQL, INCOME as INCOME_SQL, SPEND as SPEND_SQL };
