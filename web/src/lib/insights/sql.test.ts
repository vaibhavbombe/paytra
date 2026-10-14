import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { byCategoryQuery, likePattern, topPayeesQuery, totalQuery, transactionsQuery, trendQuery, type Query } from "./sql";

// Real Postgres with all real migrations, like the analytics tests.
const MIGRATIONS = join(__dirname, "..", "..", "..", "prisma", "migrations");
const U = "01900000-0000-7000-8000-000000000001";
const OTHER = "01900000-0000-7000-8000-000000000002";
const ACC = "01900000-0000-7000-8000-0000000000a1";
const ACC2 = "01900000-0000-7000-8000-0000000000a2";
const FOOD = "01900000-0000-7000-8000-0000000000c1";
const TRANSPORT = "01900000-0000-7000-8000-0000000000c2";
const SALARY = "01900000-0000-7000-8000-0000000000c3";

let db: PGlite;
let n = 0;

async function txn(dir: "DEBIT" | "CREDIT", rupees: number, date: string, category: string | null, merchant: string, user = U, acc = ACC) {
  await db.query(
    `insert into transactions(id,user_id,account_id,direction,amount_paise,txn_date,description,merchant,category_id,category_source,source,fingerprint,updated_at)
     values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$6,$7,$8,'MANUAL',$9,now())`,
    [user, acc, dir, rupees * 100, date, merchant, category, category ? "USER" : null, `i:${++n}`],
  );
}

const run = async <T,>(q: Query) => (await db.query<T>(q.sql, q.params)).rows;
const NONE = { category: null, payee: null };

beforeAll(async () => {
  db = new PGlite();
  for (const m of readdirSync(MIGRATIONS).filter((d) => /^\d/.test(d)).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, m, "migration.sql"), "utf8"));
  }
  await db.exec(`
    insert into users(id,firebase_uid,email,updated_at) values('${U}','a','a@x.in',now()),('${OTHER}','b','b@x.in',now());
    insert into accounts(id,user_id,institution_name,type,updated_at) values('${ACC}','${U}','Cash','CASH',now()),('${ACC2}','${OTHER}','Cash','CASH',now());
    insert into categories(id,name,kind) values('${FOOD}','Food & Dining','EXPENSE'),('${TRANSPORT}','Transport','EXPENSE'),('${SALARY}','Salary','INCOME');
  `);
  await txn("DEBIT", 400, "2026-09-02", FOOD, "Swiggy");
  await txn("DEBIT", 600, "2026-09-10", FOOD, "Zomato");
  await txn("CREDIT", 100, "2026-09-11", FOOD, "Swiggy"); // refund
  await txn("DEBIT", 300, "2026-09-12", FOOD, "SWIGGY INSTAMART");
  await txn("DEBIT", 250, "2026-09-15", TRANSPORT, "Rapido");
  await txn("DEBIT", 90, "2026-09-20", null, "100%_Kirana"); // uncategorised, odd characters
  await txn("CREDIT", 50000, "2026-09-01", SALARY, "Acme");
  await txn("DEBIT", 999, "2026-10-01", FOOD, "Swiggy"); // outside September
  await txn("DEBIT", 7777, "2026-09-05", FOOD, "Swiggy", OTHER, ACC2); // other user: must never appear
});

const SEP = [U, "2026-09-01", "2026-10-01"] as const;

describe("insights SQL (real Postgres, real migrations)", () => {
  it("total for all spending: refunds netted, income separate, other users excluded", async () => {
    const [r] = await run<{ spend: string; income: string; count: number }>(totalQuery(...SEP, NONE));
    expect(r).toEqual({ spend: "154000", income: "5000000", count: 7 }); // 400+600-100+300+250+90
  });

  it("total for one category", async () => {
    const [r] = await run<{ spend: string; count: number }>(totalQuery(...SEP, { category: "Food & Dining", payee: null }));
    expect([r.spend, r.count]).toEqual(["120000", 4]); // 400+600-100+300
  });

  it("payee filter is case-insensitive and partial", async () => {
    const [r] = await run<{ spend: string; count: number }>(totalQuery(...SEP, { category: null, payee: "swiggy" }));
    expect([r.spend, r.count]).toEqual(["60000", 3]); // 400 - 100 + 300 (Instamart)
  });

  it("payee filter treats % and _ literally", async () => {
    expect(likePattern("100%_K")).toBe("%100\\%\\_K%");
    const [r] = await run<{ count: number }>(totalQuery(...SEP, { category: null, payee: "100%_k" }));
    expect(r.count).toBe(1);
    const [none] = await run<{ count: number }>(totalQuery(...SEP, { category: null, payee: "%" }));
    expect(none.count).toBe(1); // only the row that really contains "%"
  });

  it("a category name in the filter can't inject SQL", async () => {
    const [r] = await run<{ count: number }>(totalQuery(...SEP, { category: "x' OR '1'='1", payee: null }));
    expect(r.count).toBe(0);
  });

  it("uncategorised can be asked for by name", async () => {
    const [r] = await run<{ spend: string }>(totalQuery(...SEP, { category: "Uncategorised", payee: null }));
    expect(r.spend).toBe("9000");
  });

  it("by category, largest first", async () => {
    const rows = await run<{ name: string; spend: string }>(byCategoryQuery(...SEP));
    expect(rows).toEqual([
      { name: "Food & Dining", spend: "120000" },
      { name: "Transport", spend: "25000" },
      { name: "Uncategorised", spend: "9000" },
    ]);
  });

  it("monthly trend with a category filter includes empty months", async () => {
    const rows = await run<{ bucket: string; spend: string }>(
      trendQuery(U, "2026-08-01", "2026-11-01", "month", { category: "Food & Dining", payee: null }),
    );
    expect(rows.map((r) => [r.bucket, r.spend])).toEqual([
      ["2026-08-01", "0"],
      ["2026-09-01", "120000"],
      ["2026-10-01", "99900"],
    ]);
  });

  it("top payees: money out only, limited", async () => {
    const rows = await run<{ payee: string; count: number; total: string }>(topPayeesQuery(...SEP, 2, NONE));
    expect(rows).toEqual([
      { payee: "Zomato", count: 1, total: "60000" },
      { payee: "Swiggy", count: 1, total: "40000" },
    ]);
  });

  it("transactions: newest first, limited, with the full match count", async () => {
    const rows = await run<{ date: string; payee: string; amount: string; matched: number }>(
      transactionsQuery(...SEP, 2, { category: null, payee: "swiggy" }),
    );
    expect(rows.map((r) => [r.date, r.payee, r.amount, r.matched])).toEqual([
      ["2026-09-12", "SWIGGY INSTAMART", "30000", 3],
      ["2026-09-11", "Swiggy", "10000", 3],
    ]);
  });
});
