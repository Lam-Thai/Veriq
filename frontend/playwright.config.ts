import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

// Every spec file that touches the real test Postgres and/or establishes a signed-in Clerk session
// (harness plan phase 6/7) — as opposed to e2e/smoke.spec.ts, e2e/pricing.spec.ts, and
// e2e/scroll-out.spec.ts, which never do either and stay fully parallel below. `resetDb()`
// (test/helpers/db.ts) does a single `TRUNCATE ... CASCADE`, which is only safe to run
// before-each when nothing else is concurrently reading/writing the same tables — see the
// "chromium-db" project below, which is exactly what makes that safe.
//
// `dashboard.spec.ts` and `sharing-verify.spec.ts` are listed here even though today they only
// cover the unauthenticated boundary: phase 7 extends both in place with DB-backed cases, and a
// single file can't be split across two projects by content, so they're scoped into the serial
// bucket now rather than only once that code lands. Plain filenames (not globs/regex) resolve
// relative to `testDir` below and match e2e/<name> exactly, so this one list is the single source
// of truth for both `chromium`'s testIgnore and `chromium-db`'s testMatch — nothing to keep in
// sync by hand, and a typo here shows up immediately as a file missing from `--list` entirely
// rather than silently double-running or dropping it.
const DB_BACKED_SPECS = [
  "dashboard.spec.ts",
  "sharing-verify.spec.ts",
  "sharing-idor.spec.ts",
  "sharing-concurrency.spec.ts",
  "sharing-rate-limit.spec.ts",
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "setup",
      testMatch: /global\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      // DB-backed specs run only in the "chromium-db" project below — never here, and never twice.
      testIgnore: DB_BACKED_SPECS,
    },
    {
      name: "chromium-db",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testMatch: DB_BACKED_SPECS,
      // `resetDb()`'s TRUNCATE races against any other in-flight test touching the same tables, so
      // these files must never run concurrently with each other — not as separate tests within one
      // file (fullyParallel: false keeps a file's own tests in-order in one worker, same as the
      // project-wide default before `fullyParallel: true` was set at the top level), and not as
      // separate files handed to different workers (workers: 1 caps this project specifically to a
      // single worker process, regardless of the top-level `workers` setting or CPU count — see
      // Playwright's TestProject.workers doc: "useful when all tests from a project share a single
      // resource... and therefore cannot be executed in parallel"). This is local-and-CI-proof: CI's
      // existing global `workers: 1` (unrelated — see comment below) would already satisfy this by
      // accident, but this project-level setting holds the guarantee locally too, where the global
      // config stays parallel-by-default.
      fullyParallel: false,
      workers: 1,
    },
  ],
  webServer: {
    // CI builds the app in its own workflow step first, so errors surface there
    // with clear logs and the server here only has to boot `next start`.
    command: process.env.CI ? "npm run start" : "npm run build && npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
