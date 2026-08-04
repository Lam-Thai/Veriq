import { randomInt } from "node:crypto";
import { test, expect } from "./helpers/db-test";
import { createTestUser, createTestDbUser, deleteTestUser, deleteTestDbUser } from "@/test/factories/user";
import { createTestReportJob } from "@/test/factories/report-job";
import { createTestShare } from "@/test/factories/share";
import { signInAs } from "./helpers/auth";
import { testDb } from "@/test/helpers/db";

// Hand-kept duplicate of lib/report-shares.ts's MAX_ACTIVE_SHARES_PER_REPORT — that module opens
// with `import "server-only"` (report-shares.ts:1), which throws unconditionally the moment it's
// loaded outside Next's webpack build (same barrier test/factories/share.ts's doc comment documents
// for mintShareToken/hashShareToken), so there's no way to import the real constant from Playwright
// test code. If the real value ever changes, this needs a matching edit.
const EXPECTED_CAP = 10;

test.describe("share cap — concurrency", () => {
  test("exactly 10 of 15 concurrent POSTs succeed, and exactly 10 rows persist", async ({ page }) => {
    const owner = await createTestUser();
    try {
      const reportJob = await createTestReportJob(owner.userId);
      await signInAs(page, owner);

      // Real advisory-lock-serialized transaction (createShareIfAllowed's
      // `pg_advisory_xact_lock(hashtext(reportJobId))`, lib/report-shares.ts) is what's actually
      // under test here — 15 real concurrent HTTP requests against one real Postgres connection
      // pool, not a mocked count check, so this can only pass if the lock genuinely serializes the
      // read-count-then-create race. 15 stays comfortably under CREATE_LIMIT (20 per 10 minutes per
      // user, app/api/report/shares/route.ts) so this test isolates the cap, not the rate limiter.
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const responses = await Promise.all(
        Array.from({ length: 15 }, () =>
          page.request.post("/api/report/shares", { data: { reportJobId: reportJob.id, expiresAt } }),
        ),
      );
      const statuses = responses.map((res) => res.status());

      const created = statuses.filter((status) => status === 201).length;
      const capReached = statuses.filter((status) => status === 409).length;

      expect(created).toBe(EXPECTED_CAP);
      expect(capReached).toBe(15 - EXPECTED_CAP);

      const persistedCount = await testDb.reportShare.count({ where: { reportJobId: reportJob.id } });
      expect(persistedCount).toBe(EXPECTED_CAP);
    } finally {
      await deleteTestUser(owner.userId, owner.clerkId);
    }
  });
});

const FIRST_VIEW_CONCURRENCY = 10;

/**
 * Proves `recordView`'s exactly-once first-view claim (lib/report-shares.ts) holds under real
 * concurrent HTTP traffic, which — per app/verify/[token]/page.tsx:177-185 — is exactly what proves
 * `sendFirstShareViewEmail` is attempted exactly once: the email send is unconditionally gated on
 * `isFirstView`, fired via `after()` right after `recordView` resolves, with no other call site
 * anywhere in the app.
 *
 * Mechanism choice: the plan's phase-7 design offered two options here — (a) reimplement
 * `recordView`'s `$transaction` verbatim against `testDb` (the same pattern test/factories/share.ts
 * already uses for `mintShareToken`/`hashShareToken`, since `lib/report-shares.ts`'s
 * `import "server-only"` makes it uncallable directly from Playwright's plain-Node runtime), or (b)
 * go through the real `GET /verify/[token]` route concurrently and infer exactly-once from its DB
 * side effects. This test uses (b). Reimplementing the transaction would duplicate the exact
 * security-sensitive statement this test exists to verify — with the same hand-sync drift risk
 * share.ts's token helpers already carry — and would skip everything upstream of `recordView` in
 * the real request path (the view-rate-limit gate, `getShareByToken`, `resolveShareStatus`). Going
 * through the route instead exercises the exact code that ships, and matches this harness's stated
 * "real HTTP against a real `next start` server" default for all five cases (see the approved
 * plan's Context section). The trade-off: `isFirstView`'s boolean value isn't observable from
 * outside the server process over HTTP, so the property is proven through its two DB-visible side
 * effects instead — `firstViewedAt` moves from null to non-null exactly once (a single nullable
 * timestamp column structurally cannot record "won twice"), and exactly `FIRST_VIEW_CONCURRENCY`
 * `ReportShareView` rows exist afterward, proving every one of the concurrent requests actually
 * reached and executed `recordView`'s `create` call for real rather than most of them silently
 * failing while only one view ever got recorded.
 */
test.describe("first-view email gate — concurrency", () => {
  test("firstViewedAt is claimed exactly once under concurrent /verify views", async ({ request }) => {
    // `/verify/[token]` is public — nothing here signs in, so the owner needs no Clerk identity.
    const owner = await createTestDbUser();
    try {
      const reportJob = await createTestReportJob(owner.userId);
      const share = await createTestShare(reportJob.id, owner.userId);

      const before = await testDb.reportShare.findUniqueOrThrow({ where: { id: share.id } });
      expect(before.firstViewedAt).toBeNull();

      // Synthetic per-test IP: the verify page's LOOKUP_RATE_LIMIT (60/60s, keyed per-IP in
      // lib/rate-limit.ts's module-scoped `buckets` Map) lives for the lifetime of the `next start`
      // server, not per test — an isolated IP keeps this burst from tripping, or being tripped by,
      // sharing-rate-limit.spec.ts's dedicated test for that same limiter, or sharing-verify.spec.ts's
      // real-share-state tests, regardless of run order.
      const ip = `10.90.${randomInt(0, 255)}.${randomInt(1, 254)}`;

      const responses = await Promise.all(
        Array.from({ length: FIRST_VIEW_CONCURRENCY }, () =>
          request.get(`/verify/${share.rawToken}`, { headers: { "X-Forwarded-For": ip } }),
        ),
      );
      for (const res of responses) expect(res.ok()).toBeTruthy();

      const after = await testDb.reportShare.findUniqueOrThrow({ where: { id: share.id } });
      expect(after.firstViewedAt).not.toBeNull();

      const viewCount = await testDb.reportShareView.count({ where: { reportShareId: share.id } });
      expect(viewCount).toBe(FIRST_VIEW_CONCURRENCY);
    } finally {
      await deleteTestDbUser(owner.userId);
    }
  });
});
