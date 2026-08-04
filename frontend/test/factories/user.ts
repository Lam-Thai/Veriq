import { createClerkTestUser, deleteClerkTestUser } from "@/e2e/helpers/auth";
import { testDb } from "@/test/helpers/db";

/**
 * Creates a real Clerk test-mode user (`createClerkTestUser`, e2e/helpers/auth.ts) and the
 * matching internal `User` row — the one place in test code these two identities get stitched
 * together, mirroring the fact that nothing in the app itself does it via a webhook.
 * `getInternalUserId` (lib/report-jobs.tsx:83-86) only ever does a `findUnique` against an
 * existing row; the app's own `User` creation is lazy and scattered (app/connect/[slug]/callback/
 * route.ts, app/api/expenses/route.ts, app/api/checkout/route.ts) — none of which a test should
 * have to drive through a real Clerk connect/checkout flow just to get a signed-in user with a DB
 * row to attach fixtures to.
 */
export type TestUser = {
  userId: string;
  clerkId: string;
  email: string;
  password: string;
};

export async function createTestUser(): Promise<TestUser> {
  const { clerkId, email, password } = await createClerkTestUser();

  const user = await testDb.user.create({
    data: { clerkId, email },
    select: { id: true },
  });

  return { userId: user.id, clerkId, email, password };
}

/**
 * Teardown counterpart to `createTestUser`. Deletes the internal row first — `onDelete: Cascade`
 * on every FK back to `User` (schema.prisma: Subscription, PlatformConnection, IncomeNarrative,
 * ReportJob, Expense, ReportShare all cascade, and ReportShareView cascades off ReportShare) means
 * this one delete clears everything a test hung off this user, without enumerating each table
 * here. The Clerk-side delete always runs too, via `finally`, even if the DB delete throws —
 * `deleteClerkTestUser` is already best-effort/non-throwing (see its own doc comment) so this
 * never risks masking a genuine DB-delete failure, while still not leaking the Clerk user on that
 * failure path.
 */
export async function deleteTestUser(userId: string, clerkId: string): Promise<void> {
  try {
    await testDb.user.delete({ where: { id: userId } });
  } finally {
    await deleteClerkTestUser(clerkId);
  }
}
