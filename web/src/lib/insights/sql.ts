// Read-only queries behind the insights chat. Same rules as analytics: sums in
// Postgres over BIGINT paise, returned as text; the same "spent" definition.
// Filters are bound parameters only: no text from the question or the model
// is ever concatenated into SQL.

import { INCOME_SQL, SPEND_SQL, TXN_FROM_SQL } from "@/lib/analytics/sql";

export type Filters = { category: string | null; payee: string | null };
export type Query = { sql: string; params: unknown[] };

/** `%text%` for ILIKE, with the user's own % and _ matched literally. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** $1 user, $2 start, $3 end (exclusive) come first; filters follow. */
function filtered(base: unknown[], f: Filters): { where: string; params: unknown[] } {
  const params = [...base];
  let where = "";
  if (f.category !== null) {
    params.push(f.category);
    where += ` AND COALESCE(c.name, 'Uncategorised') = $${params.length}::text`;
  }
  if (f.payee !== null) {
    params.push(likePattern(f.payee));
    where += ` AND COALESCE(t.merchant, t.description) ILIKE $${params.length}::text`;
  }
  return { where, params };
}

export function totalQuery(userId: string, start: string, end: string, f: Filters): Query {
  const { where, params } = filtered([userId, start, end], f);
  return {
    sql: `
SELECT COALESCE(SUM(${SPEND_SQL}), 0)::bigint::text AS spend,
       COALESCE(SUM(${INCOME_SQL}), 0)::bigint::text AS income,
       COUNT(*)::int AS count
${TXN_FROM_SQL}${where}`,
    params,
  };
}

export function byCategoryQuery(userId: string, start: string, end: string): Query {
  return {
    sql: `
SELECT COALESCE(c.name, 'Uncategorised') AS name,
       SUM(${SPEND_SQL})::bigint::text AS spend
${TXN_FROM_SQL}
GROUP BY 1
HAVING SUM(${SPEND_SQL}) > 0
ORDER BY SUM(${SPEND_SQL}) DESC, 1`,
    params: [userId, start, end],
  };
}

export function trendQuery(userId: string, start: string, end: string, bucket: "day" | "week" | "month", f: Filters): Query {
  const { where, params } = filtered([userId, start, end, bucket], f);
  return {
    sql: `
WITH buckets AS (
  SELECT generate_series(date_trunc($4::text, $2::date::timestamp), ($3::date - 1)::timestamp, ('1 ' || $4::text)::interval)::date AS b
),
sums AS (
  SELECT date_trunc($4::text, t.txn_date::timestamp)::date AS b, SUM(${SPEND_SQL}) AS spend
  ${TXN_FROM_SQL}${where}
  GROUP BY 1
)
SELECT buckets.b::text AS bucket, COALESCE(sums.spend, 0)::bigint::text AS spend
FROM buckets LEFT JOIN sums ON sums.b = buckets.b
ORDER BY buckets.b`,
    params,
  };
}

export function topPayeesQuery(userId: string, start: string, end: string, limit: number, f: Filters): Query {
  const { where, params } = filtered([userId, start, end], f);
  params.push(limit);
  return {
    sql: `
SELECT COALESCE(t.merchant, t.description) AS payee,
       COUNT(*)::int AS count,
       SUM(t.amount_paise)::bigint::text AS total
${TXN_FROM_SQL}${where}
  AND t.direction = 'DEBIT' AND (c.kind = 'EXPENSE' OR t.category_id IS NULL)
GROUP BY 1
ORDER BY SUM(t.amount_paise) DESC, 1
LIMIT $${params.length}::int`,
    params,
  };
}

export function transactionsQuery(userId: string, start: string, end: string, limit: number, f: Filters): Query {
  const { where, params } = filtered([userId, start, end], f);
  params.push(limit);
  return {
    sql: `
SELECT t.txn_date::text AS date,
       COALESCE(t.merchant, t.description) AS payee,
       t.direction::text AS direction,
       t.amount_paise::text AS amount,
       COALESCE(c.name, 'Uncategorised') AS category,
       COUNT(*) OVER ()::int AS matched
${TXN_FROM_SQL}${where}
ORDER BY t.txn_date DESC, t.created_at DESC
LIMIT $${params.length}::int`,
    params,
  };
}
