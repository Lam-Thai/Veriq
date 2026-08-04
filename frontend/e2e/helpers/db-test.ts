import { test as base, expect } from "@playwright/test";
import { resetDb } from "@/test/helpers/db";

/**
 * `test`/`expect` for every DB-backed Playwright spec — anything that touches the real test
 * Postgres, a `test/factories/*` fixture, or a signed-in Clerk session (`e2e/helpers/auth.ts`).
 * Import `{ test, expect }` from here instead of "@playwright/test" directly in such a file.
 *
 * The `resetDb` fixture below is `auto: true`, so it runs before every single test in a file that
 * imports this module — no spec file has to remember to call `resetDb()` (test/helpers/db.ts)
 * itself in its own `beforeEach`. It's a *test*-scoped (not worker-scoped) fixture on purpose: a
 * fresh `TRUNCATE` before each individual test, not once per file/worker, matching the "every test
 * starts from an empty table" isolation guarantee the harness plan calls for.
 *
 * This is only race-free because `playwright.config.ts`'s "chromium-db" project — the one project
 * whose `testMatch` can ever resolve to a file that imports this helper — runs single-worker/serial
 * (`workers: 1`, `fullyParallel: false`). A `TRUNCATE` racing another in-flight test against the
 * same tables would be a real bug; this fixture doesn't itself enforce that, the project config
 * does. Don't import this module from a spec matched by the fully-parallel "chromium" project.
 */
export const test = base.extend<{ resetDb: void }>({
  resetDb: [
    async ({}, use) => {
      await resetDb();
      await use();
    },
    { auto: true },
  ],
});

export { expect };
