import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { CATEGORY_SPLIT_SQL, TOP_PAYEES_SQL, TOTALS_SQL, TREND_SQL } from "./sql";

// Real Postgres with all real migrations, like the budget tests.
const MIGRATIONS = join(__dirname, "..", "..", "..", "prisma", "migrations");
const U = "01900000-0000-7000-8000-000000000001";
const OTHER = "01900000-0000-7000-8000-000000000002";
const ACC = "01900000-0000-7000-8000-0000000000a1";
const ACC2 = "01900000-0000-7000-8000-0000000000a2";
const FOOD = "01900000-0000-7000-8000-0000000000c1";
const SALARY = "01900000-0000-7000-8000-0000000000c2";
const SELF = "01900000-0000-7000-8000-0000000000c3";

let db: PGlite;
let n = 0;

async function txn(dir: "DEBIT" | "CREDIT", rupees: number, date: string, category: string | null, merchant: string, user = U, acc = ACC) {
  await db.query(
    `insert into transactions(id,user_id,account_id,direction,amount_paise,txn_date,description,merchant,category_id,category_source,source,fingerprint,updated_at)
     values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$6,$7,$8,'MANUAL',$9,now())`,
    [user, acc, dir, rupees * 100, date, merchant, category, category ? "USER" : null, `m:${++n}`],
  );
}

const q = async <T,>(sql: string, params: unknown[]) => (await db.query<T>(sql, params)).rows;

beforeAll(async () => {
  db = new PGlite();
  for (const m of readdirSync(MIGRATIONS).filter((d) => /^\d/.test(d)).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, m, "migration.sql"), "utf8"));
  }
  await db.exec(`
    insert into users(id,firebase_uid,email,updated_at) values('${U}','a','a@x.in',now()),('${OTHER}','b','b@x.in',now());
    insert into accounts(id,user_id,institution_name,type,updated_at) values('${ACC}','${U}','Cash','CASH',now()),('${ACC2}','${OTHER}','Cash','CASH',now());
    insert into categories(id,name,kind) values('${FOOD}','Food','EXPENSE'),('${SALARY}','Salary','INCOME'),('${SELF}','Self Transfer','TRANSFER');
  `);
  await txn("DEBIT", 400, "2026-10-01", FOOD, "Swiggy");
  await txn("DEBIT", 600, "2026-10-01", FOOD, "Zomato");
  await txn("CREDIT", 100, "2026-10-02", FOOD, "Swiggy"); // refund
  await txn("DEBIT", 250, "2026-10-04", null, "Kirana"); // uncategorised spend
  await txn("CREDIT", 50000, "2026-10-01", SALARY, "Acme"); // income
  await txn("CREDIT", 700, "2026-10-03", null, "Friend"); // uncategorised money in -> income
  await txn("DEBIT", 5000, "2026-10-02", SELF, "Own account"); // transfer: neither
  await txn("DEBIT", 999, "2026-09-30", FOOD, "Swiggy"); // previous month
  await txn("DEBIT", 888, "2026-10-01", FOOD, "Swiggy", OTHER, ACC2); // other user
});

const OCT = [U, "2026-10-01", "2026-11-01"];

describe("analytics SQL (real Postgres, real migrations)", () => {
  it("totals: spend net of refunds incl. uncategorised; income incl. uncategorised credits; no transfers", async () => {
    const [t] = await q<{ spend: string; income: string; count: number }>(TOTALS_SQL, OCT);
    expect(t).toEqual({ spend: "115000", income: "5070000", count: 7 }); // 400+600-100+250 ; 50000+700
  });

  it("daily trend fills empty days with zero and stays in range", async () => {
    const rows = await q<{ bucket: string; spend: string }>(TREND_SQL, [U, "2026-10-01", "2026-10-06", "day"]);
    expect(rows.map((r) => [r.bucket, r.spend])).toEqual([
      ["2026-10-01", "100000"],
      ["2026-10-02", "-10000"], // refund-only day nets negative
      ["2026-10-03", "0"],
      ["2026-10-04", "25000"],
      ["2026-10-05", "0"],
    ]);
  });

  it("weekly buckets start on Monday", async () => {
    const rows = await q<{ bucket: string; spend: string }>(TREND_SQL, [U, "2026-09-28", "2026-10-12", "week"]);
    // Mon 28 Sep week includes 30 Sep (999) + 1-4 Oct (1150); Mon 5 Oct week is empty
    expect(rows.map((r) => [r.bucket, r.spend])).toEqual([
      ["2026-09-28", "214900"],
      ["2026-10-05", "0"],
    ]);
  });

  it("monthly buckets over two months", async () => {
    const rows = await q<{ bucket: string; spend: string; income: string }>(TREND_SQL, [U, "2026-09-01", "2026-11-01", "month"]);
    expect(rows).toEqual([
      { bucket: "2026-09-01", spend: "99900", income: "0" },
      { bucket: "2026-10-01", spend: "115000", income: "5070000" },
    ]);
  });

  it("category split nets refunds and includes Uncategorised", async () => {
    const rows = await q(CATEGORY_SPLIT_SQL, OCT);
    expect(rows).toEqual([
      { name: "Food", spend: "90000" },
      { name: "Uncategorised", spend: "25000" },
    ]);
  });

  it("top payees: money out only, largest first, only this user", async () => {
    const rows = await q(TOP_PAYEES_SQL, [...OCT, 5]);
    expect(rows).toEqual([
      { payee: "Zomato", count: 1, total: "60000" },
      { payee: "Swiggy", count: 1, total: "40000" },
      { payee: "Kirana", count: 1, total: "25000" },
    ]);
  });
});
