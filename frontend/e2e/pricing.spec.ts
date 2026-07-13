import { test, expect } from "@playwright/test";

test.describe("pricing page", () => {
  test("loads with expected title, nav, plan tiers, prices, features, and CTAs", async ({
    page,
  }) => {
    const response = await page.goto("/pricing");
    expect(response?.ok()).toBeTruthy();

    await expect(page).toHaveTitle(/Pricing/);

    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Veriq", exact: true })).toBeVisible();

    // Plan names render as headings on each card.
    await expect(page.getByRole("heading", { level: 3, name: "Free" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Pro" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Enterprise" })).toBeVisible();

    // Price and suffix render as separate spans, so match on substrings.
    await expect(page.getByText("$0", { exact: true })).toBeVisible();
    await expect(page.getByText("$29", { exact: true })).toBeVisible();
    await expect(page.getByText("$99", { exact: true })).toBeVisible();

    // One representative feature bullet per plan, taken verbatim from lib/plans.ts. Use
    // exact:true since getByText does a case-insensitive substring match by default, and the
    // intro paragraph's copy ("...subscribe for unlimited verified reports across...") would
    // otherwise also match the Pro feature bullet text.
    await expect(page.getByText("1 verified income report", { exact: true })).toBeVisible();
    await expect(page.getByText("Unlimited verified reports", { exact: true })).toBeVisible();
    await expect(page.getByText("Bulk report generation", { exact: true })).toBeVisible();

    // Free tier CTA is a plain link to /sign-up.
    const freeCta = page.getByRole("link", { name: "Get started" });
    await expect(freeCta).toBeVisible();
    await expect(freeCta).toHaveAttribute("href", "/sign-up");

    // Pro + Enterprise CTAs are real buttons — assert presence/enabled state only, don't click
    // (clicking would hit /api/checkout, which needs a signed-in Clerk session and live Stripe
    // keys that don't exist in this test environment).
    const subscribeButtons = page.getByRole("button", { name: "Subscribe" });
    await expect(subscribeButtons).toHaveCount(2);
    await expect(subscribeButtons.nth(0)).toBeVisible();
    await expect(subscribeButtons.nth(0)).toBeEnabled();
    await expect(subscribeButtons.nth(1)).toBeVisible();
    await expect(subscribeButtons.nth(1)).toBeEnabled();
  });
});

test.describe("pricing page responsive layout", () => {
  test.describe("mobile viewport", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("renders all plan tiers", async ({ page }) => {
      const response = await page.goto("/pricing");
      expect(response?.ok()).toBeTruthy();

      await expect(page.getByRole("heading", { level: 3, name: "Free" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: "Pro" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: "Enterprise" })).toBeVisible();
    });
  });

  test.describe("desktop viewport", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("renders all plan tiers", async ({ page }) => {
      const response = await page.goto("/pricing");
      expect(response?.ok()).toBeTruthy();

      await expect(page.getByRole("heading", { level: 3, name: "Free" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: "Pro" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: "Enterprise" })).toBeVisible();
    });
  });
});
