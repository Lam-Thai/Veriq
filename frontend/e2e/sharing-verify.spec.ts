import { randomInt } from "node:crypto";
import { test, expect } from "./helpers/db-test";
import { createTestUser, deleteTestUser } from "@/test/factories/user";
import { createTestReportJob } from "@/test/factories/report-job";
import { createTestShare } from "@/test/factories/share";
import { testDb } from "@/test/helpers/db";

// A real test Postgres now exists in CI and locally (test/helpers/db.ts, test/factories/*), so the
// found/active, found/expired, and found/revoked states below (app/verify/[token]/page.tsx's other
// three branches) are no longer out of reach — the "integration-test territory... not built here"
// framing this comment used to carry is now false. The malformed-token tests immediately below are
// unchanged: a malformed token still short-circuits in getShareByToken's SHARE_TOKEN_PATTERN check
// (lib/report-shares.ts) before any query is attempted, so they need no DB seed either way.

/** Unique-per-test synthetic caller IP. The verify page's LOOKUP_RATE_LIMIT (60/60s, keyed per-IP
 * in lib/rate-limit.ts's module-scoped `buckets` Map) lives for the lifetime of the `next start`
 * server, not per test — an isolated IP keeps each of this file's DB-backed tests below from
 * tripping, or being tripped by, sharing-rate-limit.spec.ts's dedicated test for that same limiter,
 * or by each other, regardless of run order. clientIpFromHeaders (lib/ip-privacy.ts) trusts
 * x-forwarded-for verbatim with no proxy-trust check, which is exactly what makes this safe to do
 * from test code — see the approved plan's ip-privacy research note. */
function syntheticIp(): string {
  return `10.88.${randomInt(0, 255)}.${randomInt(1, 254)}`;
}

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

test.describe("/verify/[token] — real share states", () => {
  test("active share renders the report and records a view", async ({ page, context }) => {
    const owner = await createTestUser();
    try {
      const reportJob = await createTestReportJob(owner.userId);
      const share = await createTestShare(reportJob.id, owner.userId);

      await context.setExtraHTTPHeaders({ "X-Forwarded-For": syntheticIp() });
      const response = await page.goto(`/verify/${share.rawToken}`);
      expect(response?.ok()).toBeTruthy();

      await expect(page.getByRole("heading", { name: "Verified income report" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();

      // The render itself is the thing being proven "real" (as opposed to a static/cached page) —
      // a fresh ReportShareView row and a claimed firstViewedAt are the DB-visible proof this exact
      // request actually ran recordView (lib/report-shares.ts), not just that the UI happens to
      // look right.
      const viewCount = await testDb.reportShareView.count({ where: { reportShareId: share.id } });
      expect(viewCount).toBe(1);
      const dbShare = await testDb.reportShare.findUniqueOrThrow({ where: { id: share.id } });
      expect(dbShare.firstViewedAt).not.toBeNull();
    } finally {
      await deleteTestUser(owner.userId, owner.clerkId);
    }
  });

  test("expired share renders the friendly expired state, not the report", async ({ page, context }) => {
    const owner = await createTestUser();
    try {
      const reportJob = await createTestReportJob(owner.userId);
      // A past expiresAt — resolveShareStatus (app/verify/[token]/page.tsx) reads this against
      // `Date.now()` at request time, so any already-past timestamp exercises the "expired" branch.
      const share = await createTestShare(reportJob.id, owner.userId, {
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });

      await context.setExtraHTTPHeaders({ "X-Forwarded-For": syntheticIp() });
      await page.goto(`/verify/${share.rawToken}`);

      await expect(page.getByRole("heading", { name: "This link has expired." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Verified income report" })).toHaveCount(0);
    } finally {
      await deleteTestUser(owner.userId, owner.clerkId);
    }
  });

  test("revoked share renders the friendly revoked state, not the report", async ({ page, context }) => {
    const owner = await createTestUser();
    try {
      const reportJob = await createTestReportJob(owner.userId);
      const share = await createTestShare(reportJob.id, owner.userId, { revokedAt: new Date() });

      await context.setExtraHTTPHeaders({ "X-Forwarded-For": syntheticIp() });
      await page.goto(`/verify/${share.rawToken}`);

      await expect(page.getByRole("heading", { name: "This link was revoked by the report owner." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Verified income report" })).toHaveCount(0);
    } finally {
      await deleteTestUser(owner.userId, owner.clerkId);
    }
  });
});
