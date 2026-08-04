import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/** Database names the two known test-Postgres instances use — docker-compose's local service
 * (frontend/.env.test.example) and the CI service container (.github/workflows/playwright.yml).
 * Anything else refuses by default rather than trying to enumerate every shape a real DB *isn't*.
 *
 * Declared (and `assertTestDatabaseUrl` defined) before `testDb` below — `testDb`'s initializer
 * calls `assertTestDatabaseUrl` eagerly at module-evaluation time, and `const` bindings are in the
 * temporal dead zone until their own declaration runs, so the reverse order throws
 * "Cannot access 'KNOWN_TEST_DB_NAMES' before initialization" the moment this module is imported. */
const KNOWN_TEST_DB_NAMES = new Set(["veriq_test", "ci_test"]);

/**
 * Refuses to hand back a connection string that doesn't look like one of the two known
 * test-only Postgres instances. This is the guard that stands between a misconfigured
 * `.env.local` (which points `DATABASE_URL` at the real Supabase-hosted dev/prod database — see
 * frontend/.env.example) and this module ever opening a connection to it, let alone running
 * `resetDb()`'s `TRUNCATE` against it.
 *
 * Called both when `testDb` is constructed below (so a bad `DATABASE_URL` fails at import time,
 * before any query — including a plain `create` — can run) and again inside `resetDb()`
 * immediately before the destructive statement, per the harness plan's explicit ask for a
 * check scoped to the truncate itself. Never logs/interpolates the raw connection string anywhere
 * — even the throwaway test credentials are still a password, and error messages here only ever
 * reference the parsed host/db name.
 */
function assertTestDatabaseUrl(rawUrl: string | undefined): string {
  if (!rawUrl) {
    throw new Error(
      "[test/helpers/db] DATABASE_URL is not set. Test factories and resetDb() refuse to run " +
        "without an explicit test-database connection string — see frontend/.env.test.example " +
        "and run via `dotenv -e .env.test.local -- ...` (npm run test:e2e:db) locally.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(
      "[test/helpers/db] DATABASE_URL is not a valid connection URL (value withheld — connection " +
        "strings carry credentials, never logged even when malformed).",
    );
  }

  // Explicit blocklist first, even though the allowlist below would also reject this host — a
  // dedicated message is worth the redundancy: this is exactly the shape of the real dev/prod
  // database (frontend/.env.example's DATABASE_URL), so a developer who hits this specific error
  // immediately knows their `.env.local` leaked into the test run, rather than puzzling over a
  // generic "unrecognized host" message.
  //
  // Exact-or-subdomain match, not a bare `.endsWith("supabase.com")` — a plain suffix check also
  // matches a host like "evilsupabase.com" (CodeQL: "Incomplete URL substring sanitization"), which
  // isn't a live exploit here since this is a refuse-to-run blocklist (matching *more* hosts than
  // intended only makes this guard stricter, never weaker), but the allowlist below is the real
  // boundary and deserves the same precision on principle.
  const hostname = parsed.hostname;
  if (hostname === "supabase.com" || hostname.endsWith(".supabase.com")) {
    throw new Error(
      `[test/helpers/db] Refusing to run — DATABASE_URL points at a Supabase host ` +
        `("${parsed.hostname}"), the shape of the real dev/prod database (frontend/.env.example). ` +
        "Test code must only ever run against the local/CI test Postgres " +
        "(frontend/.env.test.example) — check DATABASE_URL wasn't loaded from .env.local.",
    );
  }

  // Allowlist: must be one of the two known test instances, both always reached over localhost
  // (docker-compose maps host port 5433; the CI service container maps 5432 on the runner's own
  // localhost) with a database name from the fixed set above.
  const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const dbName = parsed.pathname.replace(/^\//, "");

  if (!isLocalHost || !KNOWN_TEST_DB_NAMES.has(dbName)) {
    throw new Error(
      "[test/helpers/db] Refusing to run — DATABASE_URL doesn't match the expected test-database " +
        `shape (localhost host + db name in {${[...KNOWN_TEST_DB_NAMES].join(", ")}}). Got ` +
        `host="${parsed.hostname}" db="${dbName}". This guard exists so a misconfigured .env.local ` +
        "can never cause a test run to write to, let alone truncate, a real database.",
    );
  }

  return rawUrl;
}

/**
 * Test-only Prisma client — deliberately NOT `@/lib/db`.
 *
 * `@/lib/db` imports `@/lib/env`, which imports `@/lib/logger`, which does `import "server-only"`
 * at module scope (lib/logger.ts:1). That marker package throws unconditionally the instant it's
 * loaded outside Next's webpack build: Next's bundler swaps in a no-op via the `react-server`
 * package-exports condition, but nothing else does. Verified directly —
 * `node -e "require('server-only')"` throws "This module cannot be imported from a Client
 * Component module. It should only be used from a Server Component." — and Playwright's plain
 * Node test runner never sets that condition (same constraint `e2e/helpers/auth.ts` documents at
 * its own top for the same two modules). So any test file that imported `@/lib/db` would crash on
 * import before a single test ran, not just when the DB was actually touched.
 *
 * This client is built the same way `lib/db.ts` builds its singleton — same generated Prisma
 * client, same `PrismaPg` driver adapter — just reading `DATABASE_URL` straight off `process.env`
 * instead of through `@/lib/env`'s zod schema. Test code only ever needs that one var, so it isn't
 * worth carrying the other ~15 required fields (and the `server-only` logger dependency) into test
 * code just to get it.
 *
 * No HMR-singleton dance like `lib/db.ts`'s `globalForPrisma` — that exists to survive Next dev
 * server hot-reloads, which don't happen in a Playwright test run.
 */
export const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: assertTestDatabaseUrl(process.env.DATABASE_URL) }),
});

/**
 * Truncates every sharing-related table between test runs/cases. A single
 * `TRUNCATE TABLE "User" CASCADE` is sufficient — not because Prisma's `onDelete: Cascade`
 * annotations say so (TRUNCATE doesn't consult those; it's a schema.prisma/application-layer
 * concept, enforced by Prisma-issued `DELETE`s, not by Postgres itself), but because Postgres's
 * `TRUNCATE ... CASCADE` independently walks the real FK graph and truncates every table that
 * references the named one(s), transitively. `User` sits at the root of every table this harness
 * writes to (schema.prisma: Subscription, PlatformConnection, IncomeNarrative, ReportJob, Expense,
 * and ReportShare all carry a FK to User; ReportShareView carries one to ReportShare), so
 * truncating it alone clears the whole tree in one statement, correctly, regardless of what
 * Prisma's own cascade config says.
 *
 * Re-validates `DATABASE_URL` immediately before the destructive statement — see
 * `assertTestDatabaseUrl`'s doc comment for why this check also runs once already, at `testDb`
 * construction.
 */
export async function resetDb(): Promise<void> {
  assertTestDatabaseUrl(process.env.DATABASE_URL);
  await testDb.$executeRaw`TRUNCATE TABLE "User" CASCADE`;
}
