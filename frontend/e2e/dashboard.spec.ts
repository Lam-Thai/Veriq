import { test, expect } from "./helpers/db-test";
import { createTestUser, deleteTestUser } from "@/test/factories/user";
import { signInAs } from "./helpers/auth";

// Real Postgres + Clerk test-session infrastructure now exists (e2e/helpers/auth.ts,
// test/factories/user.ts, test/helpers/db.ts) — the unauthenticated-boundary tests below still
// stand on their own (they never touch the DB and don't need a session), and the "authenticated"
// describe block at the bottom is the case that infra was missing before: real dashboard content
// for a signed-in user, not just a redirect check.

test.describe("dashboard auth gate", () => {
  test("redirects an unauthenticated visitor away from /dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/sign-in/);
  });
});

test.describe("connect flow auth gate", () => {
  test("redirects an unauthenticated visitor away from the authorize route", async ({ page }) => {
    await page.goto("/connect/uber/authorize?state=12345678");
    await expect(page).toHaveURL(/sign-in/);
  });
});

test.describe("dashboard — authenticated", () => {
  test("renders real dashboard content for a signed-in user, not a sign-in redirect", async ({ page }) => {
    const testUser = await createTestUser();
    try {
      await signInAs(page, testUser);

      // signInAs already lands on /dashboard past proxy.ts's auth.protect() gate (see its own doc
      // comment) — assert the URL held (a client-side bounce back to /sign-in wouldn't necessarily
      // show up if we only checked once, later) and real page content that only renders once
      // app/dashboard/page.tsx's `currentUser()` resolves to a real user: the "Welcome, {name}"
      // heading and the section tablist (components/dashboard/dashboard-shell.tsx) are both built
      // from server-fetched data, not static markup a signed-out visitor could ever see.
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
    } finally {
      await deleteTestUser(testUser.userId, testUser.clerkId);
    }
  });
});
