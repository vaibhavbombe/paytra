import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { periodRange } from "@/lib/periods";

import { BUDGET_SPEND_SQL, budgetLevel, percentUsed, thresholdsReached } from "./spend";

// Real Postgres (PGlite, in-process) with every real migration applied, so
// the budget SQL is tested exactly as it runs in production.
const MIGRATIONS = join(__dirname, "..", "..", "..", "prisma", "migrations");

const U = "01900000-0000-7000-8000-000000000001";
const OTHER = "01900000-0000-7000-8000-000000000002";
const ACC = "01900000-0000-7000-8000-0000000000a1";
const ACC2 = "01900000-0000-7000-8000-0000000000a2";
const FOOD = "01900000-0000-7000-8000-0000000000c1";
const GROC = "01900000-0000-7000-8000-0000000000c2";
const SALARY = "01900000-0000-7000-8000-0000000000c3";
const SELF = "01900000-0000-7000-8000-0000000000c4";
const B = (n: number) => `01900000-0000-7000-8000-0000000000b${n}`;

// "Today" for the test: Tue 2026-10-13 -> week Mon 12..Sun 18, month October.
const TODAY = "2026-10-13";
const week = periodRange("week", TODAY);
const month = periodRange("month", TODAY);

let db: PGlite;
let n = 0;

async function txn(user: string, account: string, dir: "DEBIT" | "CREDIT", rupees: number, date: string, category: string | null) {
  await db.query(
    `insert into transactions(id,user_id,account_id,direction,amount_paise,txn_date,description,category_id,category_source,source,fingerprint,updated_at)
     values(gen_random_uuid(),$1,$2,$3,$4,$5,'t',$6,$7,'MANUAL',$8,now())`,
    [user, account, dir, rupees * 100, date, category, category ? "USER" : null, `manual:${++n}`],
  );
}

async function budget(id: string, category: string | null, period: "WEEKLY" | "MONTHLY", rupees: number, active = true) {
  await db.query(
    `insert into budgets(id,user_id,category_id,period,limit_paise,active,updated_at) values($1,$2,$3,$4,$5,$6,now())`,
    [id, U, category, period, rupees * 100, active],
  );
}

async function spend(): Promise<Record<string, bigint>> {
  const r = await db.query<{ budgetId: string; spentPaise: string }>(BUDGET_SPEND_SQL, [U, week.start, week.end, month.start, month.end]);
  return Object.fromEntries(r.rows.map((x) => [x.budgetId, BigInt(x.spentPaise)]));
}

beforeAll(async () => {
  db = new PGlite();
  for (const m of readdirSync(MIGRATIONS).filter((d) => /^\d/.test(d)).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, m, "migration.sql"), "utf8"));
  }
  await db.exec(`
    insert into users(id,firebase_uid,email,updated_at) values('${U}','a','a@x.in',now()),('${OTHER}','b','b@x.in',now());
    insert into accounts(id,user_id,institution_name,type,updated_at) values('${ACC}','${U}','Cash','CASH',now()),('${ACC2}','${OTHER}','Cash','CASH',now());
    insert into categories(id,name,kind) values('${FOOD}','Food','EXPENSE'),('${GROC}','Groceries','EXPENSE'),
      ('${SALARY}','Salary','INCOME'),('${SELF}','Self Transfer','TRANSFER');
  `);

  // October 2026
  await txn(U, ACC, "DEBIT", 1000, "2026-10-05", FOOD);
  await txn(U, ACC, "CREDIT", 200, "2026-10-07", FOOD); // refund of food
  await txn(U, ACC, "DEBIT", 500, "2026-10-12", GROC); // this week
  await txn(U, ACC, "CREDIT", 600, "2026-10-13", GROC); // big grocery refund this week
  await txn(U, ACC, "DEBIT", 300, "2026-10-13", null); // uncategorised spend this week
  await txn(U, ACC, "CREDIT", 5000, "2026-10-01", null); // uncategorised money in: must NOT count
  await txn(U, ACC, "CREDIT", 50000, "2026-10-01", SALARY); // income: must NOT count
  await txn(U, ACC, "DEBIT", 2000, "2026-10-03", SELF); // transfer: must NOT count
  // Outside the periods / other user
  await txn(U, ACC, "DEBIT", 999, "2026-09-30", FOOD); // last month
  await txn(U, ACC, "DEBIT", 400, "2026-10-11", GROC); // Sunday of LAST week (month yes, week no)
  await txn(OTHER, ACC2, "DEBIT", 700, "2026-10-05", FOOD); // someone else

  await budget(B(1), FOOD, "MONTHLY", 1000);
  await budget(B(2), null, "MONTHLY", 5000);
  await budget(B(3), null, "WEEKLY", 1000);
  await budget(B(4), GROC, "WEEKLY", 300);
  await budget(B(5), FOOD, "WEEKLY", 500, false); // inactive
});

describe("BUDGET_SPEND_SQL (real Postgres, real migrations)", () => {
  it("category budget: spend minus refunds in that category, this month only", async () => {
    expect((await spend())[B(1)]).toBe(80000n); // 1000 - 200 = ₹800
  });

  it("overall monthly: expense categories + uncategorised spend, net of refunds; never income/transfers", async () => {
    // food 800 + groceries (500 + 400 - 600) + uncategorised 300 = 1400
    expect((await spend())[B(2)]).toBe(140000n);
  });

  it("weekly uses the Monday-Sunday week (Sunday 11 Oct is last week)", async () => {
    // groceries 500 - 600 + uncategorised 300 = 200
    expect((await spend())[B(3)]).toBe(20000n);
  });

  it("never goes below zero when refunds exceed spend", async () => {
    expect((await spend())[B(4)]).toBe(0n); // 500 - 600 -> 0, not -100
  });

  it("ignores inactive budgets and other users' data", async () => {
    const s = await spend();
    expect(B(5) in s).toBe(false);
    expect(Object.keys(s).sort()).toEqual([B(1), B(2), B(3), B(4)].sort());
  });

  it("allows only one budget per category and period", async () => {
    await expect(budget(B(6), FOOD, "MONTHLY", 1)).rejects.toThrow(/unique/i);
    await expect(budget(B(7), null, "MONTHLY", 1)).rejects.toThrow(/unique/i); // overall too (NULLS NOT DISTINCT)
  });

  it("records an alert only once per budget, period and threshold", async () => {
    const insert = () =>
      db.query(
        `insert into budget_alerts(id,budget_id,user_id,period_start,threshold_percent,spent_paise,limit_paise)
         values(gen_random_uuid(),$1,$2,$3,80,80000,100000) on conflict do nothing`,
        [B(1), U, month.start],
      );
    await insert();
    await insert();
    const r = await db.query<{ n: number }>(`select count(*)::int n from budget_alerts where budget_id=$1`, [B(1)]);
    expect(r.rows[0].n).toBe(1);
  });
});

describe("integer budget maths", () => {
  it("percentUsed floors and never uses floats", () => {
    expect(percentUsed(79999n, 100000n)).toBe(79);
    expect(percentUsed(80000n, 100000n)).toBe(80);
    expect(percentUsed(1n, 3n)).toBe(33);
    expect(percentUsed(5n, 0n)).toBe(0);
  });

  it("thresholdsReached is exact at the boundary (₹799.99 of ₹1000 is not 80%)", () => {
    expect(thresholdsReached(79999n, 100000n, [80, 100])).toEqual([]);
    expect(thresholdsReached(80000n, 100000n, [80, 100])).toEqual([80]);
    expect(thresholdsReached(150000n, 100000n, [100, 80, 80])).toEqual([80, 100]);
  });

  it("budgetLevel bands", () => {
    expect(budgetLevel(10000n, 100000n, [80, 100])).toBe("ok");
    expect(budgetLevel(80000n, 100000n, [80, 100])).toBe("warning");
    expect(budgetLevel(100000n, 100000n, [80, 100])).toBe("over");
  });
});
