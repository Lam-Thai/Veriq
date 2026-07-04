import { test, expect } from "@playwright/test";

test.describe("landing page smoke", () => {
  test("loads with expected title, nav, and hero content", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.ok()).toBeTruthy();

    await expect(page).toHaveTitle(/Veriq/);

    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: "Veriq", exact: true })).toBeVisible();

    await expect(
      page.getByRole("heading", { level: 1, name: /Income verification built for gig workers/i }),
    ).toBeVisible();

    await expect(page.getByRole("link", { name: "Generate My Report" })).toBeVisible();
  });
});
