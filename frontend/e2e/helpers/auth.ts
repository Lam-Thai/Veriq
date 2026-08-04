import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import { clerkClient } from "@clerk/nextjs/server";

// Deliberately does NOT import "@/lib/env" or "@/lib/logger" — both transitively pull in the
// `server-only` package, which throws unconditionally the moment it's `require()`'d outside of
// Next.js's webpack build (Next's bundler special-cases it into a no-op for real Server
// Components; Playwright's plain Node test runner has no such alias). `clerkClient` itself has no
// such dependency, so it's safe to import directly here. Read `CLERK_SECRET_KEY` straight off
// `process.env` — it's the same repo-secret-backed env var `clerkMiddleware`/`clerkClient` already
// read (README.md's "CI: End-to-end tests" section), never written to a file, never logged.

export type ClerkTestUser = {
  clerkId: string;
  email: string;
  password: string;
};

/**
 * Creates a real user on the shared Clerk test-mode instance via the Backend API. Uses the
 * `+clerk_test@example.com` convention Clerk documents for E2E fixtures: emails matching that
 * pattern never actually get sent (verification codes, "new device" notices, etc. are all
 * suppressed instance-side), so this never risks leaking test traffic to a real inbox.
 *
 * Returns the raw password alongside the Clerk user id/email — `signInAs` needs it for the
 * `password` sign-in strategy, and the phase-5 factories module composes this with a `db.user.create`
 * call to stitch the Clerk identity to an internal `User` row (no webhook does that here).
 */
export async function createClerkTestUser(): Promise<ClerkTestUser> {
  const suffix = randomBytes(6).toString("hex");
  const email = `e2e-${suffix}+clerk_test@example.com`;
  // Random, high-entropy password. `skipPasswordChecks: true` bypasses Clerk's strength/breach
  // (HaveIBeenPwned) checks — appropriate here since the value is never chosen by a human and
  // never reused, and it avoids making every test-user creation depend on an external HIBP call
  // succeeding in CI.
  const password = randomBytes(24).toString("base64url");

  const client = await clerkClient();
  const user = await client.users.createUser({
    emailAddress: [email],
    password,
    skipPasswordChecks: true,
  });

  return { clerkId: user.id, email, password };
}

/**
 * Establishes a real authenticated Clerk session in `page` for a user created via
 * `createClerkTestUser`, using `@clerk/testing/playwright`'s `clerk.signIn` email-based ticket
 * overload — NOT the `signInParams: { strategy: "password", ... }` overload this originally
 * shipped with.
 *
 * Fixed after CI proved the password-strategy path broken: every authenticated request from every
 * spec came back 401 (see PR #50's first CI run — `dashboard.spec.ts`'s post-`signInAs` page sat on
 * `/sign-in?redirect_url=...` instead of `/dashboard`, and every rate-limit/IDOR/concurrency test
 * that depends on a real session failed the same way, while every public-route test passed
 * unaffected). Root cause: password-strategy sign-in only works if the target Clerk instance has
 * password authentication enabled as a first factor — nothing in this repo's setup guarantees that
 * for the shared CI test instance (README.md's "CI: End-to-end tests" section only documents
 * publishable/secret keys, not auth-strategy configuration).
 *
 * The email-based overload sidesteps that entirely: per `@clerk/testing`'s own type doc comment
 * (`node_modules/@clerk/testing/dist/types/common/types.d.ts`), passing `emailAddress` instead of
 * `signInParams` makes the helper look the user up via the Backend API, mint a short-lived sign-in
 * *ticket* for them, and complete sign-in with the `ticket` strategy — an admin-granted credential
 * that bypasses whichever first-factor strategies happen to be enabled/disabled for end users on
 * this instance, matching Clerk's own guidance that this path "bypasses all verification steps."
 * `createClerkTestUser` still sets a password on the created user (harmless, and satisfies any
 * instance that requires one to exist), but nothing here depends on it anymore.
 *
 * This helper owns both navigations Clerk's docs require around `clerk.signIn` — an initial
 * `page.goto("/")` (an unprotected route that still loads Clerk, satisfying "navigate to a not
 * protected page that loads Clerk" before calling the helper) and a final `page.goto("/dashboard")`
 * afterward. The second navigation isn't just cosmetic: `/dashboard` is gated by `proxy.ts`'s
 * `auth.protect()`, so successfully landing there (rather than bouncing back to `/sign-in`) is the
 * actual proof the session stuck. Callers get a page already sitting on an authenticated route and
 * can assert dashboard content or navigate further from there, instead of every call site having to
 * remember to re-verify the session itself.
 */
export async function signInAs(page: Page, testUser: Pick<ClerkTestUser, "email">): Promise<void> {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: testUser.email });
  await page.goto("/dashboard");
}

/**
 * Best-effort teardown so the shared CI Clerk test instance doesn't accumulate users across runs.
 * Never throws — matching this repo's "cleanup helpers shouldn't fail the test" convention (see
 * `lib/email.ts`'s fire-and-forget doc comment for the house rationale, applied here to sync test
 * cleanup rather than a runtime notification path): a user already deleted, or a transient Backend
 * API error during teardown, must never fail the test that already ran and asserted what it needed
 * to. Logged via `console.warn` rather than `@/lib/logger` for the same `server-only` reason
 * documented at the top of this file.
 */
export async function deleteClerkTestUser(clerkId: string): Promise<void> {
  try {
    const client = await clerkClient();
    await client.users.deleteUser(clerkId);
  } catch (err) {
    console.warn(`[e2e/helpers/auth] failed to delete Clerk test user ${clerkId} (non-fatal):`, err);
  }
}
