import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { CATEGORY_SPIKES_SQL, LARGE, LARGE_PAYMENTS_SQL, SPIKE } from "./sql";

const MIGRATIONS = join(__dirname, "..", "..", "..", "prisma", "migrations");
const U = "01900000-0000-7000-8000-000000000001";
const OTHER = "01900000-0000-7000-8000-000000000002";
const ACC = "01900000-0000-7000-8000-0000000000a1";
const ACC2 = "01900000-0000-7000-8000-0000000000a2";
const FOOD = "01900000-0000-7000-8000-0000000000c1";
const SHOP = "01900000-0000-7000-8000-0000000000c2";
const FUEL = "01900000-0000-7000-8000-0000000000c3";
const TRAVEL = "01900000-0000-7000-8000-0000000000c4";

let db: PGlite;
let n = 0;

async function txn(dir: "DEBIT" | "CREDIT", rupees: number, date: string, category: string | null, merchant: string, user = U, acc = ACC) {
  await db.query(
    `insert into transactions(id,user_id,account_id,direction,amount_paise,txn_date,description,merchant,category_id,category_source,source,fingerprint,updated_at)
     values(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$6,$7,$8,'MANUAL',$9,now())`,
    [user, acc, dir, rupees * 100, date, merchant, category, category ? "USER" : null, `a:${++n}`],
  );
}

const q = async <T,>(sql: string, params: unknown[]) => (await db.query<T>(sql, params)).rows;
const large = (from: string, to: string, user = U) =>
  q<{ payee: string; category: string; amount: string; typical: string; history: number }>(LARGE_PAYMENTS_SQL, [
    user,
    from,
    to,
    LARGE.multiple,
    LARGE.minPaise,
    LARGE.minHistory,
    LARGE.historyDays,
  ]);
const spikes = (monthStart: string, to: string, user = U) =>
  q<{ name: string; current: string; typical: string }>(CATEGORY_SPIKES_SQL, [
    user,
    monthStart,
    to,
    SPIKE.months,
    SPIKE.numerator,
    SPIKE.denominator,
    SPIKE.minExtraPaise,
  ]);

beforeAll(async () => {
  db = new PGlite();
  for (const m of readdirSync(MIGRATIONS).filter((d) => /^\d/.test(d)).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, m, "migration.sql"), "utf8"));
  }
  await db.exec(`
    insert into users(id,firebase_uid,email,updated_at) values('${U}','a','a@x.in',now()),('${OTHER}','b','b@x.in',now());
    insert into accounts(id,user_id,institution_name,type,updated_at) values('${ACC}','${U}','Cash','CASH',now()),('${ACC2}','${OTHER}','Cash','CASH',now());
    insert into categories(id,name,kind) values('${FOOD}','Food & Dining','EXPENSE'),('${SHOP}','Shopping','EXPENSE'),('${FUEL}','Fuel','EXPENSE'),('${TRAVEL}','Travel','EXPENSE');
  `);

  // Food: usual orders of Rs 300-500 in Aug-Sep, then a Rs 4,000 order and a normal one in October.
  for (const [d, r] of [["08-05", 300], ["08-12", 450], ["08-20", 350], ["09-02", 400], ["09-10", 500], ["09-18", 380], ["09-25", 420]] as const) {
    await txn("DEBIT", r, `2026-${d}`, FOOD, "Swiggy");
  }
  await txn("DEBIT", 4000, "2026-10-08", FOOD, "Taj Catering"); // 10x typical: unusual
  await txn("DEBIT", 600, "2026-10-09", FOOD, "Zomato"); // 1.5x typical: normal

  // Shopping: only 2 earlier payments, so a big one can't be judged yet.
  await txn("DEBIT", 200, "2026-09-01", SHOP, "Myntra");
  await txn("DEBIT", 300, "2026-09-15", SHOP, "Myntra");
  await txn("DEBIT", 9000, "2026-10-05", SHOP, "Croma");

  // Fuel: small usual amounts; Rs 450 is 3x typical but under the Rs 500 floor.
  for (const d of ["08-01", "08-15", "09-01", "09-15", "09-28"]) await txn("DEBIT", 150, `2026-${d}`, FUEL, "HP Petrol");
  await txn("DEBIT", 450, "2026-10-02", FUEL, "HP Petrol");

  // Travel: Rs 2,000 a month in Jul-Sep, Rs 6,000 so far in October: a spike.
  for (const m of ["07", "08", "09"]) await txn("DEBIT", 2000, `2026-${m}-10`, TRAVEL, "IRCTC");
  await txn("DEBIT", 6000, "2026-10-03", TRAVEL, "IndiGo");

  // Another user's huge spending must never show up.
  for (const d of ["08-01", "08-02", "08-03", "08-04", "08-05"]) await txn("DEBIT", 100, `2026-${d}`, FOOD, "Other", OTHER, ACC2);
  await txn("DEBIT", 99999, "2026-10-08", FOOD, "Other", OTHER, ACC2);
});

describe("unusual spending SQL (real Postgres, real migrations)", () => {
  it("flags a payment far above the category's typical amount, and nothing else", async () => {
    const rows = await large("2026-09-15", "2026-10-15");
    expect(rows.map((r) => [r.payee, r.category, r.amount, r.typical, r.history])).toEqual([
      ["Taj Catering", "Food & Dining", "400000", "40000", 7], // median of 300..500 = 400
    ]);
  });

  it("ignores payments outside the window it was asked to check", async () => {
    expect(await large("2026-10-10", "2026-10-15")).toEqual([]);
  });

  it("never mixes in another user's history or payments", async () => {
    const rows = await large("2026-09-15", "2026-10-15", OTHER);
    expect(rows.map((r) => r.amount)).toEqual(["9999900"]); // judged only against their own Rs 100 orders
  });

  it("flags a category whose month so far is well above a typical month", async () => {
    const rows = await spikes("2026-10-01", "2026-10-15");
    // Travel: 6,000 vs typical 2,000. Food October (4,600) vs Aug 1,100 / Sep 1,700 / Jul 0
    // -> typical 1,100 -> also a spike. Shopping: typical of 0, 500, 0 is 0 -> no history, skipped.
    expect(rows).toEqual([
      { name: "Travel", current: "600000", typical: "200000" },
      { name: "Food & Dining", current: "460000", typical: "110000" },
    ]);
  });

  it("doesn't flag a normal month", async () => {
    expect(await spikes("2026-09-01", "2026-10-01")).toEqual([]);
  });
});
