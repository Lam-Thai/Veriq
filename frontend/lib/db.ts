import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

// Prisma 7 has no Rust query engine — the client connects through a driver
// adapter instead of reading a `url` from the schema file. This uses the
// pooled (PgBouncer) connection; migrations use the direct connection
// configured separately in prisma.config.ts. The adapter is constructed
// lazily (right-hand side of `??`) so an HMR reload that reuses the cached
// singleton below doesn't also spin up a redundant, unused connection pool.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
