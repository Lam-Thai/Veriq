---
name: api-route
description: Use when building standard Next.js CRUD routes in app/api/**/route.ts that are session-gated and frontend-coupled — resource create/read/update/delete with zod validation, auth, rate limiting, and Prisma. Not for file parsing, ML, or long-running work (use fastapi-route).
model: sonnet
---

# Agent: Next.js API Route Builder
> Runtime: Next.js · TypeScript

## When to Use This Agent
Standard CRUD routes in `app/api/**/route.ts` that are session-gated or tightly
coupled to the frontend: resource creation, retrieval, update, delete.

**Use the `fastapi-route` agent instead when the route involves:**
- File parsing or processing (PDF, CSV, images)
- ML inference or embedding generation
- Long-running computation (>500ms expected)
- Background job dispatch
- Data aggregation over large datasets

---

## Skills
Consult these skills (`.claude/skills/<name>/SKILL.md`) before and while working:

| Skill | Purpose |
|---|---|
| `typescript` | Strict types, zod inference, branded IDs |
| `nextjs` | App Router structure, Server Actions, middleware |
| `prisma` | Query patterns, `select`, transactions, soft delete |
| `api-contracts` | Response shapes, status codes, error envelope |
| `security` | Input validation, rate limiting, security headers |
| `error-handling` | Result type, error classes, structured logging |
| `payments` | Webhook signature verification, Stripe-specific route shape (if applicable) |
| `engineering-standards` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer.
- Resource name, HTTP methods needed, and auth level (public / authed / role-gated)?
- Will this become a list endpoint? If so, expected table size — offset pagination is fine,
  or does it need cursor pagination from day one?
- Any existing route in the codebase with a similar shape to mirror conventions from?

---

## Task Protocol
1. Identify the resource (noun), HTTP method, and auth level (public / authed / role-gated).
2. Define the zod schema and response shape before writing any code.
3. Implement following the skeleton below.
4. Run the audit checklist.

---

## Directory Layout
```
app/api/
  [resource]/
    route.ts        ← GET (list), POST (create)
    [id]/
      route.ts      ← GET (single), PATCH (update), DELETE
  webhooks/
    [provider]/
      route.ts       ← see "Webhook Routes Are a Different Shape" below
```

## Ground Truth (verified against real code in this repo — not aspirational)
There is no `lib/auth.ts`. Don't invent one. The real, working precedent for everything below is
`frontend/app/api/checkout/route.ts` plus `frontend/lib/api-error.ts`, `frontend/lib/logger.ts`,
and `frontend/lib/rate-limit.ts`.
- **Auth**: call `currentUser()` or `auth()` from `@clerk/nextjs/server` directly inside the
  handler. There is no auth wrapper to import.
- **Errors**: `frontend/lib/api-error.ts` exports an `ApiError` object with only the variants
  actually in use (`unauthorized`, `notFound`, `internal`, `unprocessable`, `conflict`,
  `tooManyRequests`) — add a new variant there only when a route genuinely needs it, following
  the same `NextResponse.json({ error: { code, message } }, { status })` shape. There is no
  `handleApiError` catch-all; each route's top-level `try/catch` calls `ApiError.internal()`
  directly.
- **Logging**: `pino` is real and installed — `frontend/lib/logger.ts` exports `logger` and
  `loggerFor(requestId)`. `proxy.ts` stamps an `x-request-id` header on every request; read it
  with `(await headers()).get("x-request-id") ?? "unknown"` and pass it to `loggerFor()` at the
  top of the handler, then call e.g. `log.error({ err, ...context }, "[route] message")` —
  structured first-arg object, message string second, never string concatenation. Do not write a
  new `console.error`/`console.warn`/`console.log` in a route handler; that's the pattern this
  replaced (see `app/api/checkout/route.ts` for the real precedent).
- **Rate limiting**: `frontend/lib/rate-limit.ts` exports `checkRateLimit(key, limit, windowMs)`
  — real, installed, in-process (see the `security` skill for the single-instance caveat). Any
  route that's a plausible abuse target (creates a DB row, calls a paid third-party API, or is
  otherwise cheap to hammer) should call it keyed `` `feature:${clerkUser.id}` `` — never by IP —
  immediately after the auth check, before any other work. See `app/api/checkout/route.ts`,
  `app/api/report/route.tsx`, and `app/connect/[slug]/callback/route.ts` for three real examples
  with documented limit/window choices.
- **Async job pattern for anything genuinely heavy that must stay in Next.js**: if the work is
  CPU/latency-heavy (>500ms) *and* depends on a Node-only library with no Python port (so it
  can't move to `fastapi-route`), don't run it inline in the handler — use Next's `after()` (from
  `next/server`) to do the work after the response is sent, backed by a small DB-tracked job
  status row the client polls. `app/api/report/route.tsx` (job creation, `202 { data: { jobId } }`)
  + `app/api/report/[jobId]/route.ts` (poll/download) + `lib/report-jobs.tsx` (the actual work) is
  the real, working reference implementation — copy that shape rather than reinventing it. See
  the `nextjs` skill's "Async / Background Work" section.

## Implementation Skeleton

```ts
import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { loggerFor } from "@/lib/logger";
import { db } from "@/lib/db";

const BodySchema = z.object({
  // field: z.string().min(1).max(255),
});

const RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  try {
    // 1. Auth — runs before any other logic, no exceptions
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    // 2. Rate limit — keyed per userId, right after auth
    const { success, resetAt } = checkRateLimit(`resource:${clerkUser.id}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

    // 3. Parse and validate
    const body: unknown = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return ApiError.unprocessable(parsed.error);

    // 4. DB write — always scoped to the authenticated user
    const result = await db.resource.create({
      data: { ...parsed.data, userId: clerkUser.id },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    log.error({ err }, "[POST /api/resource] unhandled error");
    return ApiError.internal();
  }
}
```

## Webhook Routes Are a Different Shape
A route that receives events from a third party (Stripe, GitHub, etc.) is not the CRUD skeleton
above — see `frontend/app/api/webhooks/stripe/route.ts` for the real, working pattern:
- **No Clerk auth** — the caller is the third party, not a logged-in user. Trust comes entirely
  from verifying a signature header against a shared secret.
- **Raw body required for signature verification** — call `request.text()`, never
  `request.json()`, before verifying. Most providers' SDKs (e.g. Stripe's
  `constructEvent`) need the exact raw bytes that were signed; parsing to JSON first breaks
  the signature check.
- **Reject before processing** — verify the signature and return 400 on failure *before* any
  event data is read or acted on. No code path should touch `event.data` pre-verification.
- **Idempotent writes** — third parties redeliver events. Prefer `updateMany`/`upsert` keyed on
  a unique external id over anything that increments or appends.
- See the `payments` skill for the Stripe-specific version of this pattern in full.

## Non-Negotiable Rules
- Auth is line 1 (except webhook routes — see above). Zero logic runs before it.
- Always `safeParse` — never `parse` (throws raw zod errors to client).
- Always `select` on Prisma — never return full model rows.
- PATCH body uses `BodySchema.partial()` — never require full object for updates.
- Single-resource routes scope `where` to `{ id, userId: <clerk-derived id> }`.
- Return 404 (not 403) when a user accesses a resource they don't own — never confirm existence.
- Response envelope is always `{ data: T }` success or `{ error: { code, message } }` failure.
- Never trust a client-supplied id for anything server-resolves-and-trusts (a price, a plan, a
  role) — validate against a closed enum and resolve the real value server-side.

## Audit Checklist
- [ ] Auth check is first line of every handler (webhook routes: signature check is)
- [ ] `safeParse` used, not `parse`
- [ ] Rate limiting applied (`checkRateLimit` from `lib/rate-limit.ts`, keyed per `userId`) if
      this route is a plausible abuse target
- [ ] Logging uses `loggerFor(requestId)` from `lib/logger.ts`, not a new `console.*` call
- [ ] Anything genuinely CPU/latency-heavy (>500ms) and Node-only is backgrounded via the
      `after()` job pattern (see `app/api/report/route.tsx`), not run inline
- [ ] Resource ownership: `userId` in `where` clause
- [ ] `select` on all Prisma queries
- [ ] No internal error details in response body
- [ ] Correct HTTP status codes (201 create, 204 delete, 422 validation, 202 async job accepted)
- [ ] Webhook routes: raw body used for signature verification, verified before any processing
- [ ] Passes the `engineering-standards` Definition of Done
