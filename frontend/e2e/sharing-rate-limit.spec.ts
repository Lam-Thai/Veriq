import { randomBytes, randomInt } from "node:crypto";
import { test, expect } from "./helpers/db-test";
import { createTestUser, deleteTestUser } from "@/test/factories/user";
import { createTestReportJob } from "@/test/factories/report-job";
import { signInAs } from "./helpers/auth";

/**
 * Proves the 429 + Retry-After contract (`ApiError.tooManyRequests`, lib/api-error.ts) actually
 * fires once each route's own `checkRateLimit` call (lib/rate-limit.ts) is exhausted — one test per
 * rate-limited route, per the approved plan's phase-7 design.
 *
 * The four limit constants below are hand-kept duplicates of the real ones (`CREATE_LIMIT`/
 * `REVOKE_LIMIT`/`VIEWS_LIMIT` in the three owner-facing route files, `LOOKUP_RATE_LIMIT` in
 * app/api/verify/[token]/download/route.ts) — those route files are read-only for this harness (see
 * the approved plan's Out of Scope), so there's no export to import instead. If a route's own
 * constant ever changes, this file needs a matching edit.
 */
const CREATE_LIMIT = 20; // app/api/report/shares/route.ts, 600_000ms window
const REVOKE_LIMIT = 30; // app/api/report/shares/[id]/route.ts, 60_000ms window
const VIEWS_LIMIT = 60; // app/api/report/shares/[id]/views/route.ts, 60_000ms window
const LOOKUP_RATE_LIMIT = 30; // app/api/verify/[token]/download/route.ts, 60_000ms window

/** Unique-per-test synthetic caller IP for the one public, IP-keyed route below. The verify/download
 * routes' rate limiters are in-process, module-scoped Maps (lib/rate-limit.ts) that live for the
 * lifetime of the `next start` server, not per test — an isolated IP is what keeps this test's
 * deliberate trip of LOOKUP_RATE_LIMIT from leaking into sharing-verify.spec.ts's or
 * sharing-concurrency.spec.ts's public-route tests, or vice versa, regardless of run order.
 * clientIpFromHeaders (lib/ip-privacy.ts) trusts x-forwarded-for verbatim with no proxy-trust check,
 * which is exactly what makes this safe to do from test code. */
function syntheticIp(): string {
  return `10.77.${randomInt(0, 255)}.${randomInt(1, 254)}`;
}

/** 43-char base64url, matching SHARE_TOKEN_PATTERN's shape (lib/report-shares.ts) without ever
 * corresponding to a real ReportShare row. LOOKUP_RATE_LIMIT fires before any DB lookup, so a
 * well-formed-but-nonexistent token trips it exactly the same as a real one would — no factory-built
 * share is needed for this test. */
function wellFormedUnknownToken(): string {
  return randomBytes(32).toString("base64url");
}

function retryAfterSeconds(headers: Record<string, string>): number {
  return Number(headers["retry-after"]);
}

/**
 * Asserts the limiter tripped *exactly once, on the very last request*, and that the 429 carries a
 * usable `Retry-After`.
 *
 * The "exactly one" half is what pins the configured threshold. Asserting only that the final
 * response is a 429 (which is all these tests used to do) passes just as happily against a limiter
 * that rejected every request from the first one onward — so it would have proven the route can
 * emit 429, not that it emits 429 *at the right point*. Requiring every earlier response to be
 * something other than 429 is what makes the limit value itself part of the contract under test.
 *
 * Deliberately does not assert what the earlier statuses *are* — that differs per route by design
 * (the create loop sees 201s then 409s once the cap-of-10 kicks in; the revoke/views loops see 404s
 * throughout, since their limiter runs before the ownership lookup). Pinning those here would
 * couple this to unrelated behaviour each route already has its own test for.
 */
function expectLimiterTrippedOnlyOnLastRequest(statuses: number[], lastHeaders: Record<string, string>): void {
  expect(statuses.filter((status) => status === 429)).toHaveLength(1);
  expect(statuses.at(-1)).toBe(429);

  const retryAfter = retryAfterSeconds(lastHeaders);
  expect(Number.isInteger(retryAfter)).toBe(true);
  expect(retryAfter).toBeGreaterThan(0);
}

/**
 * Gap between iterations in the three *authenticated* loops below. Not cosmetic, and not a flake
 * workaround — it's throttling a third-party dependency.
 *
 * Every authenticated request the app serves calls `currentUser()` in its route handler, and that
 * is a Clerk Backend API fetch (unlike `auth()`, which verifies the session JWT locally). So the
 * VIEWS loop, which must exceed a limit of 60, puts 61 Clerk API calls on the wire — and fired back
 * to back that reliably trips Clerk's own rate limit on the shared test instance. When it does, the
 * handler's `currentUser()` throws inside its try block and the route returns `ApiError.internal()`,
 * so the assertion fails with "Expected 429, Received 500" — a failure that looks like the limiter
 * under test is broken when nothing about it is. (Seen in CI on PR #50 after two runs landed close
 * together; the identical code had passed on the previous run.)
 *
 * Pacing at ~120ms keeps this under roughly 8 requests/sec. The property under test is unaffected:
 * each limiter's window is 60s (600s for create), and even the 61-iteration loop finishes in ~10s,
 * so every request still lands inside one window and the fixed-window counter trips exactly as it
 * would have unpaced.
 */
const REQUEST_PACING_MS = 120;

function pace(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, REQUEST_PACING_MS));
}

test.describe("rate limiting — 429 + Retry-After", () => {
  test("POST /api/report/shares returns 429 with Retry-After once CREATE_LIMIT is exceeded", async ({ page }) => {
    const owner = await createTestUser();
    try {
      const reportJob = await createTestReportJob(owner.userId);
      await signInAs(page, owner);

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const statuses: number[] = [];
      let lastHeaders: Record<string, string> = {};
      // Sequential, not concurrent — checkRateLimit's fixed-window counter is what's under test
      // here, and a strictly-ordered loop is what guarantees the (CREATE_LIMIT + 1)-th call is the
      // one that observes the limit already exhausted, rather than racing the counter itself.
      for (let i = 0; i < CREATE_LIMIT + 1; i++) {
        if (i > 0) await pace();
        const res = await page.request.post("/api/report/shares", {
          data: { reportJobId: reportJob.id, expiresAt },
        });
        statuses.push(res.status());
        lastHeaders = res.headers();
      }

      expectLimiterTrippedOnlyOnLastRequest(statuses, lastHeaders);
    } finally {
      await deleteTestUser(owner.userId, owner.clerkId);
    }
  });

  test("DELETE /api/report/shares/[id] returns 429 with Retry-After once REVOKE_LIMIT is exceeded", async ({
    page,
  }) => {
    const owner = await createTestUser();
    try {
      await signInAs(page, owner);

      const statuses: number[] = [];
      let lastHeaders: Record<string, string> = {};
      for (let i = 0; i < REVOKE_LIMIT + 1; i++) {
        if (i > 0) await pace();
        // A fake share id is fine: the route checks the rate limit before the ownership/existence
        // lookup (app/api/report/shares/[id]/route.ts — auth, then checkRateLimit, then
        // getInternalUserId/revokeShare), so every one of these still consumes the limiter's bucket
        // even though none of them would ever revoke a real share. This trips the limiter itself,
        // not a wall of 404s that happen to also be 404s for an unrelated reason.
        const res = await page.request.delete("/api/report/shares/nonexistent-share-id");
        statuses.push(res.status());
        lastHeaders = res.headers();
      }

      expectLimiterTrippedOnlyOnLastRequest(statuses, lastHeaders);
    } finally {
      await deleteTestUser(owner.userId, owner.clerkId);
    }
  });

  test("GET /api/report/shares/[id]/views returns 429 with Retry-After once VIEWS_LIMIT is exceeded", async ({
    page,
  }) => {
    const owner = await createTestUser();
    try {
      await signInAs(page, owner);

      const statuses: number[] = [];
      let lastHeaders: Record<string, string> = {};
      for (let i = 0; i < VIEWS_LIMIT + 1; i++) {
        if (i > 0) await pace();
        // Same ordering as the DELETE case above: app/api/report/shares/[id]/views/route.ts checks
        // the rate limit before getInternalUserId/getViewsForShare, so a fake id still trips it.
        const res = await page.request.get("/api/report/shares/nonexistent-share-id/views");
        statuses.push(res.status());
        lastHeaders = res.headers();
      }

      expectLimiterTrippedOnlyOnLastRequest(statuses, lastHeaders);
    } finally {
      await deleteTestUser(owner.userId, owner.clerkId);
    }
  });

  test("GET /api/verify/[token]/download returns 429 with Retry-After once LOOKUP_RATE_LIMIT is exceeded", async ({
    request,
  }) => {
    const ip = syntheticIp();
    const token = wellFormedUnknownToken();

    // No pacing here, unlike the three above: this route is unauthenticated, so it never calls
    // `currentUser()` and puts no load on Clerk's Backend API.
    const statuses: number[] = [];
    let lastHeaders: Record<string, string> = {};
    for (let i = 0; i < LOOKUP_RATE_LIMIT + 1; i++) {
      const res = await request.get(`/api/verify/${token}/download`, { headers: { "X-Forwarded-For": ip } });
      statuses.push(res.status());
      lastHeaders = res.headers();
    }

    expectLimiterTrippedOnlyOnLastRequest(statuses, lastHeaders);
  });
});
