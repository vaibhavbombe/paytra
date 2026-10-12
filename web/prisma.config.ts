// Prisma CLI config (migrate, generate, studio). Not used at runtime.
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Next.js convention: local secrets live in .env.local (git-ignored).
config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a DIRECT (non-pooled) Neon connection: PgBouncer in
    // transaction mode doesn't support the session-level features migrate uses.
    url: env("DIRECT_URL"),
  },
});
