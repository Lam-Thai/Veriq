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
There is no `lib/auth.ts`, `lib/ratelimit.ts`, or `lib/logger.ts` in this repo. Don't import
them — they don't exist. The real, working precedent for everything below is
`frontend/app/api/checkout/route.ts` plus `frontend/lib/api-error.ts`.
- **Auth**: call `currentUser()` or `auth()` from `@clerk/nextjs/server` directly inside the
  handler. There is no auth wrapper to import.
- **Errors**: `frontend/lib/api-error.ts` exports an `ApiError` object with only the variants
  actually in use (`unauthorized`, `notFound`, `internal`, `unprocessable`, `conflict`) — add a
  new variant there only when a route genuinely needs it, following the same
  `NextResponse.json({ error: { code, message } }, { status })` shape. There is no
  `handleApiError` catch-all; each route's top-level `try/catch` calls `ApiError.internal()`
  directly.
- **Logging**: `console.error("[route-name] context", err)` is the current, accepted pattern —
  see the `error-handling` skill for why (no `pino`/`lib/logger.ts` installed yet).
- **Rate limiting**: no rate-limit infra (`@upstash/ratelimit` or otherwise) is installed in
  this repo yet. Don't import `@/lib/ratelimit` — it doesn't exist. Note the gap in your
  output instead of silently omitting it or inventing a fake import; see the `security` skill.

## Implementation Skeleton
```ts
import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { ApiError } from "@/lib/api-error";
import { db } from "@/lib/db";

const BodySchema = z.object({
  // field: z.string().min(1).max(255),
});

export async function POST(request: NextRequest) {
  try {
    // 1. Auth — runs before any other logic, no exceptions
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    // 2. Parse and validate
    const body: unknown = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return ApiError.unprocessable(parsed.error);

    // 3. DB write — always scoped to the authenticated user
    const result = await db.resource.create({
      data: { ...parsed.data, userId: clerkUser.id },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/resource] unhandled error", err);
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
- [ ] Rate limiting gap noted if this route is a plausible abuse target (no infra to apply yet)
- [ ] Resource ownership: `userId` in `where` clause
- [ ] `select` on all Prisma queries
- [ ] No internal error details in response body
- [ ] Correct HTTP status codes (201 create, 204 delete, 422 validation)
- [ ] Webhook routes: raw body used for signature verification, verified before any processing
- [ ] Passes the `engineering-standards` Definition of Done
