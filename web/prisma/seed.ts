// Seeds the built-in categories every user shares (user_id = NULL).
// Safe to run any number of times: ON CONFLICT DO NOTHING via skipDuplicates,
// backed by the NULLS NOT DISTINCT unique index on (user_id, name).
// Run with: npx prisma db seed
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type CategoryKind } from "../src/generated/prisma/client";
import { normaliseKey } from "../src/lib/categorise/engine";

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

// Built-in rules: well-known Indian merchants and bank keywords.
// Patterns are whole words, matched against the payee/description
// (see src/lib/categorise/engine.ts). More specific patterns win, e.g.
// "SWIGGY INSTAMART" (groceries) beats "SWIGGY" (food).
// [category, direction (null = either), patterns...]
const SYSTEM_RULES: [string, "DEBIT" | "CREDIT" | null, string[]][] = [
  ["Food & Dining", "DEBIT", ["SWIGGY", "ZOMATO", "DOMINOS", "MCDONALDS", "KFC", "STARBUCKS", "PIZZA HUT", "BURGER KING", "EATSURE", "HALDIRAMS", "CHAAYOS", "RESTAURANT", "CAFE"]],
  ["Groceries", "DEBIT", ["BIGBASKET", "BLINKIT", "ZEPTO", "DMART", "AVENUE SUPERMARTS", "JIOMART", "SWIGGY INSTAMART", "INSTAMART", "MORE RETAIL", "RELIANCE FRESH", "NATURES BASKET", "SPENCERS", "KIRANA"]],
  ["Shopping", "DEBIT", ["AMAZON", "FLIPKART", "MYNTRA", "AJIO", "NYKAA", "MEESHO", "TATA CLIQ", "DECATHLON", "IKEA", "CROMA", "RELIANCE DIGITAL", "LIFESTYLE", "WESTSIDE"]],
  ["Transport", "DEBIT", ["UBER", "OLA", "RAPIDO", "NAMMA YATRI", "METRO", "FASTAG", "PARKING", "REDBUS"]],
  ["Fuel", "DEBIT", ["INDIAN OIL", "IOCL", "HPCL", "HINDUSTAN PETROLEUM", "BPCL", "BHARAT PETROLEUM", "SHELL", "NAYARA", "PETROL"]],
  ["Utilities & Bills", "DEBIT", ["BESCOM", "MSEDCL", "TATA POWER", "ADANI ELECTRICITY", "TORRENT POWER", "BSES", "MAHANAGAR GAS", "INDRAPRASTHA GAS", "ELECTRICITY", "WATER BILL", "GAS BILL", "BBPS"]],
  ["Mobile & Internet", "DEBIT", ["AIRTEL", "JIO", "RELIANCE JIO", "VODAFONE", "VI", "BSNL", "ACT FIBERNET", "HATHWAY", "TATA PLAY", "RECHARGE"]],
  ["Subscriptions", "DEBIT", ["NETFLIX", "SPOTIFY", "HOTSTAR", "JIOHOTSTAR", "PRIME VIDEO", "AMAZON PRIME", "YOUTUBE PREMIUM", "APPLE COM BILL", "GOOGLE PLAY", "SONYLIV", "ZEE5"]],
  ["Entertainment", "DEBIT", ["BOOKMYSHOW", "PVR", "INOX", "DISTRICT", "PAYTM INSIDER"]],
  ["Health & Medical", "DEBIT", ["APOLLO", "PHARMEASY", "TATA 1MG", "1MG", "NETMEDS", "PRACTO", "MEDPLUS", "HOSPITAL", "CLINIC", "PHARMACY", "DIAGNOSTICS"]],
  ["Education", "DEBIT", ["UDEMY", "COURSERA", "BYJUS", "UNACADEMY", "SCHOOL FEES", "COLLEGE FEES", "TUITION"]],
  ["Travel", "DEBIT", ["MAKEMYTRIP", "GOIBIBO", "IRCTC", "CLEARTRIP", "INDIGO", "AIR INDIA", "AKASA", "SPICEJET", "AIRBNB", "OYO", "IXIGO", "YATRA"]],
  ["EMI & Loans", "DEBIT", ["BAJAJ FINANCE", "BAJAJ FINSERV", "HOME LOAN", "LOAN EMI", "EMI", "HDFC LTD", "TATA CAPITAL", "HOME CREDIT"]],
  ["Insurance", "DEBIT", ["LIC", "LIFE INSURANCE", "HDFC LIFE", "ICICI PRU", "ICICI PRUDENTIAL", "SBI LIFE", "STAR HEALTH", "NIVA BUPA", "POLICYBAZAAR", "ACKO", "DIGIT INSURANCE", "INSURANCE PREMIUM"]],
  ["Rent", "DEBIT", ["RENT", "NOBROKER", "HOUSE RENT", "NOBROKERHOOD"]],
  ["Personal Care", "DEBIT", ["URBAN COMPANY", "SALON", "SPA", "LAKME"]],
  ["Gifts & Donations", "DEBIT", ["DONATION", "GIVEINDIA", "TEMPLE", "CHARITY"]],
  ["Fees & Charges", "DEBIT", ["SERVICE CHARGES", "SERVICE CHARGE", "SMS CHARGES", "ANNUAL FEE", "LATE PAYMENT FEE", "GST ON", "CONVENIENCE FEE", "PENALTY", "DEBIT CARD FEE", "MIN BAL CHARGES"]],
  ["Salary", "CREDIT", ["SALARY", "SAL CREDIT", "PAYROLL"]],
  ["Interest", "CREDIT", ["INTEREST", "INT PD", "SB INT", "FD INTEREST"]],
  ["Refund & Cashback", "CREDIT", ["REFUND", "CASHBACK", "REVERSAL", "REV"]],
  // Transfers: moving your own money, not spending or earning it.
  ["Self Transfer", null, ["ATM WITHDRAWAL", "SELF", "OWN ACCOUNT", "CREDIT CARD PAYMENT", "CC PAYMENT", "CARD PAYMENT RECEIVED", "CRED"]],
  ["Investments", null, ["ZERODHA", "GROWW", "UPSTOX", "ANGEL ONE", "KUVERA", "COIN BY ZERODHA", "MUTUAL FUND", "SIP", "NPS", "PPF", "INDMONEY", "ICCL", "NSE CLEARING", "BSE"]],
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

    const categoryIds = new Map(
      (await db.category.findMany({ where: { userId: null }, select: { id: true, name: true } })).map((c) => [c.name, c.id]),
    );
    const rules = SYSTEM_RULES.flatMap(([category, direction, patterns]) => {
      const categoryId = categoryIds.get(category);
      if (!categoryId) throw new Error(`Unknown category in SYSTEM_RULES: ${category}`);
      return patterns.map((pattern) => ({
        userId: null,
        pattern: normaliseKey(pattern),
        matchType: "CONTAINS" as const,
        direction,
        categoryId,
      }));
    });
    const { count: ruleCount } = await db.categoryRule.createMany({ data: rules, skipDuplicates: true });

    // This list is the source of truth for built-in rules: remove any that
    // were dropped or moved. (Users' own rules are never touched.)
    const wanted = new Set(rules.map((r) => `${r.pattern}|${r.direction}|${r.categoryId}`));
    const stale = (await db.categoryRule.findMany({
      where: { userId: null },
      select: { id: true, pattern: true, direction: true, categoryId: true },
    })).filter((r) => !wanted.has(`${r.pattern}|${r.direction}|${r.categoryId}`));
    if (stale.length) await db.categoryRule.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } });

    const totalRules = await db.categoryRule.count({ where: { userId: null } });
    console.log(`Seeded ${ruleCount} new built-in rules, removed ${stale.length} stale (${totalRules} total).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
