import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// Runtime uses the POOLED Neon URL (PgBouncer) so many short-lived Cloud Run
// requests don't exhaust Postgres connections.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

function createClient() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Reuse one client across hot reloads in dev; otherwise every file save would
// open a new connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
