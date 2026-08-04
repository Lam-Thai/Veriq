import { test, expect } from "./helpers/db-test";
import { createTestUser, createTestDbUser, deleteTestUser, deleteTestDbUser } from "@/test/factories/user";
import { createTestReportJob } from "@/test/factories/report-job";
import { createTestShare } from "@/test/factories/share";
import { signInAs } from "./helpers/auth";
import { testDb } from "@/test/helpers/db";

/**
 * Proves the IDOR convention documented on `revokeShare`/`getViewsForShare`
 * (lib/report-shares.ts): both scope their lookup to `userId`, so a share owned by someone else is
 * indistinguishable, from the outside, from one that doesn't exist at all — 404, never 403 (see
 * app/api/report/shares/[id]/route.ts and .../[id]/views/route.ts's own doc comments, which cite
 * app/api/expenses/[id]/route.ts as the repo-wide precedent for this shape). A 403 here would leak
 * "this id is real, you just don't own it" — exactly the signal the convention exists to deny.
 */
test.describe("IDOR — report shares", () => {
  test("another user's DELETE and GET views on my share both 404, and my share stays active", async ({
    browser,
  }) => {
    // Only the attacker ever signs in — the owner exists purely to own the report/share rows, so
    // it needs no Clerk identity (see createTestDbUser's doc comment on the shared instance's
    // Backend API budget).
    const owner = await createTestDbUser();
    // Nested scopes, not one flat try/finally over both: the attacker is created *inside* the
    // owner's cleanup scope so a failure in `createTestUser` (a real possibility — it calls Clerk's
    // rate-limited Backend API) can't strand the owner row, and the two teardowns can't block each
    // other. The attacker's is the one that matters most, since it's the only one holding a Clerk
    // identity that `resetDb()`'s TRUNCATE cannot reclaim.
    try {
      const attacker = await createTestUser();
      try {
        const reportJob = await createTestReportJob(owner.userId);
        const share = await createTestShare(reportJob.id, owner.userId);

        // The attacker needs their own signed-in session, established in a separate browser context
        // so its cookies can never collide with — or accidentally reuse — the owner's session.
        const attackerContext = await browser.newContext();
        try {
          const attackerPage = await attackerContext.newPage();
          await signInAs(attackerPage, attacker);

          const deleteRes = await attackerPage.request.delete(`/api/report/shares/${share.id}`);
          expect(deleteRes.status()).toBe(404);
          expect((await deleteRes.json()).error.code).toBe("NOT_FOUND");

          const viewsRes = await attackerPage.request.get(`/api/report/shares/${share.id}/views`);
          expect(viewsRes.status()).toBe(404);
          expect((await viewsRes.json()).error.code).toBe("NOT_FOUND");
        } finally {
          await attackerContext.close();
        }

        // Ground truth straight from Postgres: the attacker's DELETE must not have revoked the
        // share through any path outside revokeShare's userId-scoped updateMany. If it had, this
        // would be the only place that shows it — the 404 above proves the response lied about
        // nothing, not that nothing happened.
        const dbShare = await testDb.reportShare.findUniqueOrThrow({ where: { id: share.id } });
        expect(dbShare.revokedAt).toBeNull();
      } finally {
        await deleteTestUser(attacker.userId, attacker.clerkId);
      }
    } finally {
      await deleteTestDbUser(owner.userId);
    }
  });
});
