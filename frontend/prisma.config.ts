import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// This repo keeps local secrets in .env.local (Next.js convention), not the
// dotenv-default .env — load it explicitly so `prisma migrate`/`studio`/etc.
// see the same vars `next dev` does.
config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // The migration engine needs a direct (non-pooled) connection — Supabase's
  // pooled/PgBouncer connection (DATABASE_URL) doesn't reliably support the
  // DDL/prepared statements Migrate issues. The app's runtime client (lib/db.ts)
  // uses the pooled DATABASE_URL instead, via a driver adapter.
  datasource: {
    url: env("DIRECT_URL"),
  },
});
