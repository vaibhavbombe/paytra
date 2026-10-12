// Seeds the built-in categories every user shares (user_id = NULL).
// Safe to run any number of times: ON CONFLICT DO NOTHING via skipDuplicates,
// backed by the NULLS NOT DISTINCT unique index on (user_id, name).
// Run with: npx prisma db seed
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type CategoryKind } from "../src/generated/prisma/client";

config({ path: ".env.local", quiet: true });

const SYSTEM_CATEGORIES: { name: string; kind: CategoryKind; icon: string }[] = [
  // Expenses
  { name: "Food & Dining", kind: "EXPENSE", icon: "utensils" },
  { name: "Groceries", kind: "EXPENSE", icon: "shopping-basket" },
  { name: "Rent", kind: "EXPENSE", icon: "home" },
  { name: "Utilities & Bills", kind: "EXPENSE", icon: "bolt" },
  { name: "Mobile & Internet", kind: "EXPENSE", icon: "wifi" },
  { name: "Fuel", kind: "EXPENSE", icon: "fuel" },
  { name: "Transport", kind: "EXPENSE", icon: "bus" },
  { name: "Shopping", kind: "EXPENSE", icon: "shopping-bag" },
  { name: "Entertainment", kind: "EXPENSE", icon: "film" },
  { name: "Subscriptions", kind: "EXPENSE", icon: "repeat" },
  { name: "Health & Medical", kind: "EXPENSE", icon: "heart-pulse" },
  { name: "Education", kind: "EXPENSE", icon: "graduation-cap" },
  { name: "Travel", kind: "EXPENSE", icon: "plane" },
  { name: "EMI & Loans", kind: "EXPENSE", icon: "landmark" },
  { name: "Insurance", kind: "EXPENSE", icon: "shield" },
  { name: "Personal Care", kind: "EXPENSE", icon: "sparkles" },
  { name: "Gifts & Donations", kind: "EXPENSE", icon: "gift" },
  { name: "Fees & Charges", kind: "EXPENSE", icon: "receipt" },
  { name: "Other Expense", kind: "EXPENSE", icon: "circle" },
  // Income
  { name: "Salary", kind: "INCOME", icon: "briefcase" },
  { name: "Interest", kind: "INCOME", icon: "percent" },
  { name: "Refund & Cashback", kind: "INCOME", icon: "undo" },
  { name: "Other Income", kind: "INCOME", icon: "circle-plus" },
  // Money moving between the user's own accounts / investments: excluded from
  // spend totals so a transfer isn't counted as both an expense and income.
  { name: "Self Transfer", kind: "TRANSFER", icon: "arrow-left-right" },
  { name: "Investments", kind: "TRANSFER", icon: "trending-up" },
];

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL / DATABASE_URL is not set");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const { count } = await db.category.createMany({
      data: SYSTEM_CATEGORIES.map((c) => ({ ...c, userId: null })),
      skipDuplicates: true,
    });
    const total = await db.category.count({ where: { userId: null } });
    console.log(`Seeded ${count} new system categories (${total} total).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
