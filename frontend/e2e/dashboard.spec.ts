import { test, expect } from "@playwright/test";

// No Clerk test-session infrastructure exists in this repo, so these specs only cover the
// unauthenticated boundary (matching the existing e2e philosophy in smoke.spec.ts/pricing.spec.ts)
// — the actual regression guard for proxy.ts gating /dashboard and /connect(.*) behind auth.

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
