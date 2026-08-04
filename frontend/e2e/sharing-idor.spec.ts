import { test, expect } from "./helpers/db-test";
import { createTestUser, deleteTestUser } from "@/test/factories/user";
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
    const owner = await createTestUser();
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

      // Ground truth straight from Postgres: the attacker's DELETE must not have revoked the share
      // through any path outside revokeShare's userId-scoped updateMany. If it had, this would be
      // the only place that shows it — the 404 above proves the response lied about nothing, not
      // that nothing happened.
      const dbShare = await testDb.reportShare.findUniqueOrThrow({ where: { id: share.id } });
      expect(dbShare.revokedAt).toBeNull();
    } finally {
      await deleteTestUser(owner.userId, owner.clerkId);
      await deleteTestUser(attacker.userId, attacker.clerkId);
    }
  });
});
