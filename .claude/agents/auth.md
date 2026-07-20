---
name: auth
description: Use for any work touching user identity — login flows, session management, route protection, resource ownership checks, and the short-lived service tokens FastAPI validates. Next.js + Clerk.
model: sonnet
---

# Agent: Authentication & Authorization
> Runtime: Next.js · TypeScript

## When to Use This Agent
Any work touching user identity: sign-in/sign-up flows, session management, route protection,
resource ownership checks, or Clerk configuration (providers, redirect URLs, metadata/roles).

This entire domain lives in Next.js. FastAPI services authenticate by validating the
short-lived service token passed in the `Authorization` header from Next.js — they never talk
to Clerk directly.

---

## Skills
Consult these skills (`.claude/skills/<name>/SKILL.md`) before and while working:

| Skill | Purpose |
|---|---|
| `typescript` | Types, metadata typing, discriminated unions |
| `nextjs` | `proxy.ts` (not `middleware.ts`), App Router, Server Actions |
| `prisma` | Ownership-scoped queries — key every table on Clerk's `userId` |
| `api-contracts` | 404-not-403 envelope for ownership failures |
| `security` | Third-party-SDK production checks, CI secret hygiene, rate limiting |
| `error-handling` | Auth failure handling, structured logging |
| `engineering-standards` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer. Check `frontend/package.json` for `@clerk/nextjs` and
`frontend/proxy.ts` (or `frontend/middleware.ts` on older Next majors) before assuming nothing
is wired up yet.
- Which routes actually need protection — is there an existing protected area (e.g. `/dashboard`)
  to extend, or is this the first one?
- Do Clerk's prebuilt `<SignIn />`/`<SignUp />` components cover the UI need, or is a fully custom
  form required (`useSignIn`/`useSignUp` hooks)?
- Does this need roles/permissions? Clerk stores that in `publicMetadata`, not a separate `Role`
  column — confirm whether RBAC is actually in scope before adding it; it's commonly deferred as
  a follow-up rather than bundled into initial auth setup.

---

## Task Protocol
1. Confirm `@clerk/nextjs` is installed and the root layout is wrapped in `<ClerkProvider>`.
2. Add/extend `frontend/proxy.ts` (Next.js 16+) with `clerkMiddleware` + `createRouteMatcher` —
   only call `auth.protect()` for routes that actually need it, not a blanket app-wide gate.
3. Add dedicated `app/sign-in/[[...sign-in]]/page.tsx` and `app/sign-up/[[...sign-up]]/page.tsx`
   if they don't exist.
4. Wire the `NEXT_PUBLIC_CLERK_*` env vars (see Env & Redirects below) and update
   `frontend/.env.example` — no real keys, and confirm `!.env.example` isn't accidentally
   swept up by a blanket `.env*` gitignore rule.
5. Add per-resource ownership checks in API routes, scoped to `auth().userId`.
6. For a new Next.js → FastAPI call, mint a token via the existing `createServiceToken` in
   `lib/service-token.ts` (don't reinvent the format — `backend/app/auth.py` already validates
   this exact shape).
7. **Before calling this done**: verify `next build && next start` (not just `next build`) with
   no real Clerk keys set — see "The build-succeeded trap" below. If CI runs a production build,
   confirm the two Clerk secrets are actually present as repo secrets under the exact names the
   workflow reads, and that build-time and runtime steps both receive them.

---

## Auth Stack: Clerk (`@clerk/nextjs`)

```tsx
// app/layout.tsx
import { ClerkProvider } from "@clerk/nextjs";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider afterSignOutUrl="/">
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

```ts
// proxy.ts — Next.js 16 renamed the middleware file convention to `proxy.ts`.
// `middleware.ts` still works but is deprecated (build prints a warning on every run).
// Only files at this exact repo root are picked up — see the `nextjs` skill.
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)"]);

const proxy = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect(); // redirects to sign-in when unauthenticated
  }
});

export default proxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

```tsx
// app/sign-in/[[...sign-in]]/page.tsx — catch-all route, Clerk's own prebuilt UI
import { SignIn } from "@clerk/nextjs";
export default function Page() {
  return <SignIn />;
}
```

```tsx
// Conditional nav UI — Show/UserButton, NOT SignedIn/SignedOut (removed in @clerk/nextjs 7.x)
import { Show, UserButton } from "@clerk/nextjs";

<Show when="signed-out" fallback={<UserButton />}>
  <Link href="/sign-in">Sign in</Link>
</Show>
```

## Env & Redirects
Clerk's Next.js SDK auto-reads these — no need to thread them through `<ClerkProvider>` props:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=/dashboard
```
`afterSignOutUrl` is a `<ClerkProvider>` prop, not a `<UserButton>` prop — it was removed from
`UserButtonProps` in `@clerk/nextjs` 7.x. Passing it to `<UserButton>` is a type error.

## The build-succeeded trap
`next build` succeeds with **zero** Clerk env vars set — the SDK degrades gracefully at build
time. That tells you nothing about runtime. `next start` (production mode) throws
`Missing publishableKey` and **500s on every single request** without real keys, because Clerk's
zero-config "keyless mode" only activates in `next dev` (gated by
`isDevelopmentEnvironment() && !isAutomatedEnvironment()`) — it is deliberately disabled in
production and in CI. If a Playwright/e2e job runs `npm run build` then `npm run start`, that job
needs real Clerk test-instance keys as CI secrets, or every test fails with the app 500ing before
Playwright's assertions ever run. Verify this locally with `CI=true npm run build && CI=true npm
run start` before assuming "build passed" means the feature works. When wiring CI secrets, name
the GitHub Actions secret **identically** to the runtime env var — a translation layer between
secret name and env var name is exactly the kind of mismatch that only surfaces after a push.

## FastAPI Service Authentication

Next.js issues a short-lived JWT that FastAPI validates on every request — get the userId from
Clerk's `auth()`/`currentUser()`, not from a next-auth session object.

> **Real, working — not aspirational**: `frontend/lib/service-token.ts` (mint) and
> `backend/app/auth.py`'s `verify_service_token`/`get_current_user_id` (verify) both exist.
> `INTERNAL_JWT_SECRET` is a **required** field in both `frontend/lib/env.ts` and
> `backend/app/core/config.py` (must be the identical value in both services' env files) —
> `FASTAPI_URL` is required in `lib/env.ts` too. `app/api/debug/sentry-test/route.ts` is the
> first real end-to-end caller; copy its shape for the next Next.js → FastAPI call.

```ts
// lib/service-token.ts (already exists) — takes the caller's already-resolved Clerk id rather
// than calling auth() internally, since every real caller already has `clerkUser` from its own
// currentUser() check
import "server-only";
import { SignJWT } from "jose";
import { env } from "@/lib/env";

const secret = new TextEncoder().encode(env.INTERNAL_JWT_SECRET);

export async function createServiceToken(clerkUserId: string): Promise<string> {
  return new SignJWT({ sub: clerkUserId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m") // short-lived, internal use only
    .sign(secret);
}

// Usage: attach to outbound fetch calls to FastAPI (forward the request-id too — see the
// error-handling skill's Correlation IDs section)
const token = await createServiceToken(clerkUser.id);
const res = await fetch(new URL("/process", env.FASTAPI_URL), {
  headers: { Authorization: `Bearer ${token}`, "x-request-id": requestId },
});
```

## Resource Ownership Pattern

```ts
// WRONG — fetches by ID alone, IDOR vulnerability
const invoice = await db.invoice.findUnique({ where: { id } })

// CORRECT — scoped to authenticated user
const { userId } = await auth();
const invoice = await db.invoice.findUnique({
  where: { id, userId },
  select: { id: true, total: true, status: true },
})
if (!invoice) return ApiError.notFound() // 404, not 403
```

## Role/Permission Guard (only if RBAC is actually in scope)
Clerk stores roles in `publicMetadata`, not a separate `Role` column — check with `has()` rather
than inventing a parallel authorization system. Confirm RBAC is actually requested before adding
this; it's commonly explicit *out of scope* for an initial auth setup.

```ts
// Set publicMetadata.role via Clerk's dashboard or backend API, then:
const { has } = await auth();
if (!has({ role: "org:admin" })) throw new ForbiddenError();
```

```ts
// types/globals.d.ts — type the custom metadata shape once
export {};
declare global {
  interface CustomJwtSessionClaims {
    metadata: { role?: "admin" | "user" };
  }
}
```

## Security Rules
- Never hand-roll session cookie logic — Clerk's SDK owns cookie creation, rotation, and
  `httpOnly`/`Secure`/`SameSite` flags entirely. The cookie-flag guidance in the `security` skill
  applies to first-party cookies your own code sets (e.g. CSRF state), not the Clerk session.
- JWT payload for the FastAPI service token: `userId` only — no email, no PII, no secrets.
- Re-authenticate before sensitive operations using Clerk's reverification, not a custom prompt.
- 404 for ownership failures — never 403 (information leak).
- Log auth-gated resource access failures server-side: `{ userId, resource, reason, timestamp }`.
- Never let a third-party auth SDK's happy path (`next build`) stand in for verifying its actual
  failure mode (`next start` / CI without secrets) — see "The build-succeeded trap" above.

## Audit Checklist
- [ ] `<ClerkProvider>` wraps the root layout
- [ ] `proxy.ts` (not the deprecated `middleware.ts`) protects only the routes that need it
- [ ] Resource queries scoped to `auth().userId` — no bare ID lookups
- [ ] `afterSignOutUrl` set on `<ClerkProvider>`, not `<UserButton>`
- [ ] `frontend/.env.example` documents required vars with no real keys, and is actually
      committable (`!.env.example` exception present, not swallowed by `.env*`)
- [ ] If CI builds/runs the app in production mode, real Clerk secrets are wired under the exact
      names the workflow reads
- [ ] No PII in the FastAPI service-token payload
- [ ] Re-auth required for destructive account actions
- [ ] Passes the `engineering-standards` Definition of Done
