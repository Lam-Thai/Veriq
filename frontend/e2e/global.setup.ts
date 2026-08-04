import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

// Playwright *project-based* setup (a dedicated "setup" project other projects `dependencies` on
// in playwright.config.ts) — deliberately not the `globalSetup` config option. Clerk's own docs
// confirm a function-based `globalSetup` runs in a separate Node process, so the `CLERK_FAPI`/
// `CLERK_TESTING_TOKEN` env vars `clerkSetup()` sets never propagate to the actual test workers.
// Running it as a real (serial) test inside the Playwright test process is the only way those
// vars land where `clerk.signIn()`/`setupClerkTestingToken()` (helpers/auth.ts) can read them.
//
// `describe.configure({ mode: "serial" })` matters if this file ever grows a second `setup` test
// — it guarantees Clerk's testing token is fetched before anything else in this project runs.
setup.describe.configure({ mode: "serial" });

setup("global setup", async () => {
  // Reads CLERK_SECRET_KEY / NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY from process.env (same CI test-mode
  // instance described in README.md's "CI: End-to-end tests" section) and fetches a testing token
  // from Clerk's Backend API that bypasses bot-protection challenges in every subsequent test.
  await clerkSetup();
});
