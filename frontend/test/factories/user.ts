import { randomBytes } from "node:crypto";
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

  let user: { id: string };
  try {
    user = await testDb.user.create({
      data: { clerkId, email },
      select: { id: true },
    });
  } catch (err) {
    // The Clerk user already exists at this point, so a failed DB insert would strand it: no test
    // holds a reference to clean it up, and `resetDb()`'s TRUNCATE only clears Postgres. Orphans
    // accumulate on the shared test instance run after run and eat into the Backend API rate-limit
    // headroom the suite depends on (see e2e/helpers/auth.ts's withClerkRetry). Undo the Clerk side
    // before rethrowing — `deleteClerkTestUser` never throws, so the original error is what
    // surfaces, not a teardown failure masking it.
    await deleteClerkTestUser(clerkId);
    throw err;
  }

  return { userId: user.id, clerkId, email, password };
}

/** A `User` row with no Clerk identity behind it. `clerkId` is a synthetic, unique-but-fake value
 * that resolves to nothing on the Clerk instance — which is exactly the point. */
export type TestDbUser = {
  userId: string;
  clerkId: string;
  email: string;
};

/**
 * Creates ONLY the internal `User` row — no Clerk Backend API call at all.
 *
 * Use this for any spec that never calls `signInAs`: the public `/verify/[token]` state tests, the
 * concurrent first-view test (also public), and the *owner* half of an IDOR test where only the
 * attacker needs a session. Those tests need a real row to satisfy `ReportJob.userId`/
 * `ReportShare.userId` foreign keys and to give the share an owner email, not a real identity.
 *
 * Why this exists rather than just always using `createTestUser`: the whole suite shares one Clerk
 * test instance whose Backend API is rate-limited, and CI has already tripped it — creating a Clerk
 * user for a test that never authenticates spends that budget for nothing (see
 * `e2e/helpers/auth.ts`'s `withClerkRetry` doc comment for the full failure mode). Roughly half the
 * DB-backed specs are in this category.
 *
 * `clerkId` is deliberately prefixed `dbonly_` rather than mimicking Clerk's `user_` shape: nothing
 * should ever be able to resolve it against Clerk, and if one of these ever *does* leak into a code
 * path expecting a real Clerk id, the prefix makes that obvious at a glance instead of sending
 * someone hunting for a deleted user. Email keeps the `+clerk_test` convention purely so it's
 * recognisable as fixture data.
 */
export async function createTestDbUser(): Promise<TestDbUser> {
  const suffix = randomBytes(6).toString("hex");
  const clerkId = `dbonly_${suffix}`;
  const email = `e2e-dbonly-${suffix}+clerk_test@example.com`;

  const user = await testDb.user.create({
    data: { clerkId, email },
    select: { id: true },
  });

  return { userId: user.id, clerkId, email };
}

/** Teardown for `createTestDbUser`. Only touches Postgres — there's no Clerk user to delete.
 * `onDelete: Cascade` clears dependent rows, same as `deleteTestUser`. */
export async function deleteTestDbUser(userId: string): Promise<void> {
  await testDb.user.delete({ where: { id: userId } });
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
