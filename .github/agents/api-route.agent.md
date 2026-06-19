# Agent: Next.js API Route Builder
> Runtime: Next.js · TypeScript

## When to Use This Agent
Standard CRUD routes in `app/api/**/route.ts` that are session-gated or tightly
coupled to the frontend: resource creation, retrieval, update, delete.

**Use `fastapi-route.agent.md` instead when the route involves:**
- File parsing or processing (PDF, CSV, images)
- ML inference or embedding generation
- Long-running computation (>500ms expected)
- Background job dispatch
- Data aggregation over large datasets

---

## Skills
| Skill | Purpose |
|---|---|
| `#file:.github/skills/typescript.skill.md` | Strict types, zod inference, branded IDs |
| `#file:.github/skills/nextjs.skill.md` | App Router structure, Server Actions, middleware |
| `#file:.github/skills/api-contracts.skill.md` | Response shapes, status codes, error envelope |
| `#file:.github/skills/security.skill.md` | Input validation, rate limiting, security headers |
| `#file:.github/skills/error-handling.skill.md` | Result type, error classes, structured logging |

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
```

## Implementation Skeleton
```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { ApiError, handleApiError } from '@/lib/api-error'
import { ratelimit } from '@/lib/ratelimit'
import { logger } from '@/lib/logger'

const BodySchema = z.object({
  // field: z.string().min(1).max(255),
})

export async function POST(req: NextRequest) {
  try {
    // 1. Auth — runs before any other logic, no exceptions
    const session = await auth()
    if (!session) return ApiError.unauthorized()

    // 2. Rate limit per user
    const { success } = await ratelimit.limit(session.user.id)
    if (!success) return ApiError.tooManyRequests()

    // 3. Parse and validate
    const body = await req.json()
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) return ApiError.unprocessable(parsed.error)

    // 4. DB write — always scoped to session.user.id
    const result = await db.resource.create({
      data: { ...parsed.data, userId: session.user.id },
      select: { id: true, createdAt: true },
    })

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (err) {
    logger.error({ err, route: 'POST /api/[resource]' }, 'Unhandled error')
    return handleApiError(err)
  }
}
```

## Non-Negotiable Rules
- Auth is line 1. Zero logic runs before it.
- Always `safeParse` — never `parse` (throws raw zod errors to client).
- Always `select` on Prisma — never return full model rows.
- PATCH body uses `BodySchema.partial()` — never require full object for updates.
- Single-resource routes scope `where` to `{ id, userId: session.user.id }`.
- Return 404 (not 403) when a user accesses a resource they don't own — never confirm existence.
- Response envelope is always `{ data: T }` success or `{ error: { code, message } }` failure.

## Audit Checklist
- [ ] Auth check is first line of every handler
- [ ] `safeParse` used, not `parse`
- [ ] Rate limit applied
- [ ] Resource ownership: `userId` in `where` clause
- [ ] `select` on all Prisma queries
- [ ] No internal error details in response body
- [ ] Correct HTTP status codes (201 create, 204 delete, 422 validation)
