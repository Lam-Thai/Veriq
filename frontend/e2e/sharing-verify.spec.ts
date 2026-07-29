import { test, expect } from "@playwright/test";

// This repo's Playwright CI job runs `next build` + `next start` against a placeholder
// DATABASE_URL with no real Postgres service (see .github/workflows/playwright.yml), and there is
// no Clerk test-session infrastructure (see e2e/dashboard.spec.ts's own note on the same gap). That
// means there is no way to seed a real ReportShare row here, so this spec only covers the one state
// that needs zero DB access: a malformed token short-circuits in getShareByToken's
// SHARE_TOKEN_PATTERN check (lib/report-shares.ts) before any query is attempted, rendering the
// generic "This link isn't valid." message. The found/active, found/expired, and found/revoked
// states (app/verify/[token]/page.tsx's other three branches) all require a real ReportShare row
// backed by a real ReportJob and are integration-test territory once Postgres is available in CI —
// not built here, per the same constraint the approved plan documents.

test.describe("/verify/[token] — malformed token", () => {
  test("renders the generic invalid-link message for an obviously malformed token", async ({ page }) => {
    // Short garbage string — nowhere near SHARE_TOKEN_PATTERN's ^[A-Za-z0-9_-]{43}$ shape, so
    // getShareByToken returns null without ever touching the database.
    const response = await page.goto("/verify/not-a-real-token");
    expect(response?.ok()).toBeTruthy();

    await expect(page.getByRole("heading", { name: "This link isn't valid." })).toBeVisible();
    await expect(page.getByText(/Double-check the link you were given/i)).toBeVisible();

    // Must never leak which of "malformed" vs "well-formed but unknown" this was, nor reveal any
    // owner/report detail — this is the one message state a viewer must never be able to distinguish
    // from a well-formed-but-nonexistent token.
    await expect(page.getByText(/revoked|expired/i)).toHaveCount(0);
  });

  test("is marked noindex, nofollow — this route must never be surfaced by a search engine", async ({ page }) => {
    await page.goto("/verify/not-a-real-token");

    const robotsMeta = page.locator('meta[name="robots"]');
    await expect(robotsMeta).toHaveAttribute("content", /noindex/);
    await expect(robotsMeta).toHaveAttribute("content", /nofollow/);
  });
});
