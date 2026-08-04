import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";

// Deliberately does NOT import "@/lib/env" or "@/lib/logger" — both transitively pull in the
// `server-only` package, which throws unconditionally the moment it's `require()`'d outside of
// Next.js's webpack build (Next's bundler special-cases it into a no-op for real Server
// Components; Playwright's plain Node test runner has no such alias).
//
// For the same reason this uses `@clerk/backend`'s framework-agnostic `createClerkClient` rather
// than `clerkClient` from `@clerk/nextjs/server`: that export is built for Next server contexts
// (request-scoped config resolution), and this file runs under Playwright's plain Node runner where
// none of that exists. It happens to work today by falling through to env vars, but nothing
// guarantees that across Clerk majors, and depending on it here contradicts the rule the paragraph
// above exists to enforce. `@clerk/testing` resolves its own Backend API client exactly this way.
//
// `CLERK_SECRET_KEY` is read straight off `process.env` — the same repo-secret-backed var
// `clerkMiddleware` already reads (README.md's "CI: End-to-end tests" section), never written to a
// file, never logged.

export type ClerkTestUser = {
  clerkId: string;
  email: string;
  password: string;
};

let cachedBackendClient: ReturnType<typeof createClerkClient> | undefined;

/** Lazily-built Backend API client. Deliberately not constructed at module scope: every DB-backed
 * spec imports this file transitively (via the factories), including the ones that never touch
 * Clerk at all, and a module-scope construction would make a missing `CLERK_SECRET_KEY` fail those
 * at import time rather than at the point of actual use. */
function backendClient(): ReturnType<typeof createClerkClient> {
  if (!cachedBackendClient) {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        "[e2e/helpers/auth] CLERK_SECRET_KEY is not set — authenticated e2e specs need real " +
          "Clerk test-mode credentials. Locally, populate frontend/.env.test.local and run via " +
          "`npm run test:e2e:db`; in CI it comes from the repo secret of the same name.",
      );
    }
    cachedBackendClient = createClerkClient({ secretKey });
  }
  return cachedBackendClient;
}

const MAX_CLERK_RETRIES = 3;
/** Ceiling on a single backoff wait. Clerk's 429s have come back with `retryAfter: 10` (seconds),
 * and blindly honouring that twice would blow past even the extended per-test timeout — so cap the
 * wait and let the attempt budget run out instead of stalling the whole suite on one call. */
const MAX_CLERK_BACKOFF_MS = 6_000;

/**
 * Retries a Clerk Backend API call on 429 with exponential backoff + jitter, honouring the
 * `retryAfter` the error carries when it's within `MAX_CLERK_BACKOFF_MS`.
 *
 * This exists because the whole suite shares one Clerk test instance and that instance's Backend
 * API is genuinely rate-limited: every authenticated request the *app* serves calls `currentUser()`
 * (which is a Backend API fetch, unlike `auth()`'s local JWT verify), so a spec like
 * sharing-rate-limit's VIEWS case — 61 requests to trip a limit of 60 — puts 61 Clerk calls on the
 * wire by itself, on top of the harness's own create/delete traffic. Observed failure mode when
 * that budget runs out is two-headed and easy to misread: the harness's `users.createUser` throws
 * `ClerkAPIResponseError: Too Many Requests`, *and* the app's own routes start returning 500
 * (`currentUser()` throws inside the handler's try, which returns `ApiError.internal()`), so a
 * rate-limit spec fails with "Expected 429, Received 500" for a reason that has nothing to do with
 * the limiter under test. Mirrors the retry/backoff `@clerk/testing` already applies to its own
 * testing-token fetch.
 *
 * Retries only 429 — a 4xx from a malformed request or a 5xx from Clerk should surface immediately,
 * not be masked by three more attempts.
 */
async function withClerkRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 429 || attempt >= MAX_CLERK_RETRIES) throw err;

      const retryAfterMs = (err as { retryAfter?: number }).retryAfter;
      const backoffMs = Math.min(
        retryAfterMs != null ? retryAfterMs * 1_000 : 500 * 2 ** attempt,
        MAX_CLERK_BACKOFF_MS,
      );
      const waitMs = backoffMs + Math.random() * 250;
      console.warn(
        `[e2e/helpers/auth] Clerk 429 on ${label}, attempt ${attempt + 1}/${MAX_CLERK_RETRIES} — ` +
          `waiting ${Math.round(waitMs)}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/**
 * Creates a real user on the shared Clerk test-mode instance via the Backend API. Uses the
 * `+clerk_test@example.com` convention Clerk documents for E2E fixtures: emails matching that
 * pattern never actually get sent (verification codes, "new device" notices, etc. are all
 * suppressed instance-side), so this never risks leaking test traffic to a real inbox.
 *
 * Only for specs that actually sign in. A spec that just needs a row to hang fixtures off (the
 * public `/verify/[token]` cases, or the *owner* side of an IDOR test where only the attacker
 * signs in) should use `createTestDbUser` from `@/test/factories/user` instead — it skips Clerk
 * entirely, which is the single biggest lever on this suite's Backend API budget.
 */
export async function createClerkTestUser(): Promise<ClerkTestUser> {
  const suffix = randomBytes(6).toString("hex");
  const email = `e2e-${suffix}+clerk_test@example.com`;
  // Random, high-entropy password. `skipPasswordChecks: true` bypasses Clerk's strength/breach
  // (HaveIBeenPwned) checks — appropriate here since the value is never chosen by a human and
  // never reused, and it avoids making every test-user creation depend on an external HIBP call
  // succeeding in CI.
  const password = randomBytes(24).toString("base64url");

  const client = backendClient();
  const user = await withClerkRetry(
    () => client.users.createUser({ emailAddress: [email], password, skipPasswordChecks: true }),
    "users.createUser",
  );

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
    const client = backendClient();
    // Retried like creation: a 429 here is non-fatal to the test that already passed, but a
    // swallowed one leaks a user onto the shared instance permanently, and enough of those make
    // the next run's rate-limit headroom worse. Better to back off and actually land the delete.
    await withClerkRetry(() => client.users.deleteUser(clerkId), "users.deleteUser");
  } catch (err) {
    console.warn(`[e2e/helpers/auth] failed to delete Clerk test user ${clerkId} (non-fatal):`, err);
  }
}
