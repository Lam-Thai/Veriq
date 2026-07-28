---
name: api-contracts
description: Shared API response contract for both Next.js and FastAPI — the { data } / { error } envelope, HTTP status code table, Next.js error factory, FastAPI response schemas, pagination contract, and internal service contract. Use when designing route responses or error shapes.
---

# Skill: API Contracts
> Shared — applies to both Next.js and FastAPI responses

## Response Envelope (both runtimes, always consistent)

```ts
// Success
{ "data": T, "meta"?: PaginationMeta }

// Error
{ "error": { "code": "MACHINE_READABLE", "message": "Human readable", "fields"?: Record<string, string[]> } }
```

Never deviate from this shape. Clients depend on it.

---

## HTTP Status Codes

| Code | When |
|---|---|
| `200` | Successful GET or PATCH |
| `201` | Successful POST that creates a resource |
| `202` | Request accepted, processing async (background job enqueued) |
| `200` | Successful DELETE — returns `{ data: { id } }`, **not** a bare `204`. See note below |
| `400` | Malformed syntax (JSON parse failed, bad param type) |
| `401` | Not authenticated |
| `403` | Authenticated but not permitted for this action |
| `404` | Not found — also use when user doesn't own the resource (IDOR protection) |
| `409` | Conflict — duplicate resource (unique constraint) |
| `413` | Payload too large (file upload) |
| `422` | Valid syntax, failed business validation |
| `429` | Rate limit exceeded — include a `Retry-After` header (seconds), derived from the limiter's actual window/reset time, not a guessed constant |
| `500` | Internal server error — never leak details |

### DELETE returns `200 { data: { id } }` — a deliberate deviation from the REST default
Textbook REST says `204 No Content`. This repo returns `200` with the deleted id in the standard
envelope, and every real DELETE route does it consistently — `app/api/expenses/[id]/route.ts`,
`app/api/report/shares/[id]/route.ts`. Two reasons: the client gets an unambiguous confirmation of
*which* row the server acted on (useful for reconciling optimistic UI when several deletes are in
flight), and every response in the app stays inside the one `{ data }` / `{ error }` envelope
rather than one verb carving out a bodyless exception.

This entry previously said `204`, which no route ever implemented — the doc was corrected to match
the code, not the reverse. If you're writing a DELETE, return `200 { data: { id } }`.

---

## Next.js Error Factory
```ts
// lib/api-error.ts
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

export const ApiError = {
  unauthorized:     () => NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 }),
  forbidden:        () => NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Access denied' } }, { status: 403 }),
  notFound:         () => NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 }),
  conflict:         () => NextResponse.json({ error: { code: 'CONFLICT', message: 'Already exists' } }, { status: 409 }),
  tooManyRequests:  (retryAfterSeconds: number) => NextResponse.json(
    { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    { status: 429, headers: { 'Retry-After': String(Math.max(0, retryAfterSeconds)) } },
  ),
  internal:         () => NextResponse.json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }, { status: 500 }),
  unprocessable: (err: ZodError) => NextResponse.json({
    error: { code: 'VALIDATION_FAILED', message: 'Validation failed', fields: err.flatten().fieldErrors }
  }, { status: 422 }),
}

export function handleApiError(err: unknown, log: ReturnType<typeof loggerFor>): NextResponse {
  if (err instanceof ZodError) return ApiError.unprocessable(err)
  if (err instanceof NotFoundError) return ApiError.notFound()
  if (err instanceof ConflictError) return ApiError.conflict()
  log.error({ err }, '[API Error]')
  return ApiError.internal()
}
```
(`handleApiError` itself is illustrative — the real routes in this repo each call `ApiError.internal()`
directly from their own top-level `try/catch` rather than going through a shared catch-all; see the
`error-handling` skill for the real `loggerFor` import and the routes it's actually used in.)

---

## FastAPI: Same Envelope
```python
# app/schemas/common.py
from pydantic import BaseModel
from typing import Generic, TypeVar

T = TypeVar("T")

class DataResponse(BaseModel, Generic[T]):
    data: T

class ErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, list[str]] | None = None

class ErrorResponse(BaseModel):
    error: ErrorDetail
```

---

## Pagination Contract

### Offset (simple; small/bounded tables)
```ts
// Request: GET /api/invoices?page=0&perPage=20&sort=createdAt&order=desc

// Response:
{
  "data": [...],
  "meta": { "page": 0, "perPage": 20, "total": 143, "totalPages": 8 }
}
```

### Keyset / cursor (tables that grow, or when the spec says keyset)
Same envelope, but `meta` carries an opaque forward cursor instead of page/total (no `COUNT(*)` on
a hot path). `nextCursor` is `null` on the last page. The real reference is
`app/api/expenses/route.ts` + `lib/expense-data.ts`:
```ts
// Request: GET /api/expenses?limit=20&cursor=<lastId>&category=SUPPLIES
{
  "data": [...],
  "meta": { "nextCursor": "cljk3x9..." | null }
}
```
Implementation notes (Prisma): order by a stable, unique-terminated key
(`orderBy: [{ date: "desc" }, { id: "desc" }]`), fetch `take: limit + 1` as a "has-more" probe,
and page with `cursor: { id }, skip: 1`. **Ownership-gate the cursor before use** — Prisma resolves
the cursor row by primary key *before* the `where` filter applies, so a cursor is IDOR surface (see
the `security` skill). Clamp `limit` in the query zod schema (`.max(50)`), never trust it raw.

---

## Async Job Contract (`202` — real, working example)
For anything that must not run inline in the request/response cycle (see the `engineering-standards`
Scalability gate and the `nextjs` skill's `after()` section) — the creating call returns `202`
immediately with just an id, and a separate poll endpoint reports status, still inside the same
envelope shape:
```ts
// POST /api/report → 202
{ "data": { "jobId": "cljk3x9..." } }

// GET /api/report/[jobId] → 202 while pending, still not an error
{ "data": { "status": "PENDING" | "PROCESSING" } }

// GET /api/report/[jobId] → 200 once ready — for a file result this is the raw
// Content-Type: application/pdf body, not a { data } envelope wrapping it; for a JSON-shaped
// result, use the normal { data: T } envelope instead
```
`app/api/report/route.tsx` (create) + `app/api/report/[jobId]/route.ts` (poll/download) is the
real, working reference — copy that status-row shape (`PENDING`/`PROCESSING`/`READY`/`FAILED`)
rather than inventing a new one per feature.

---

## Internal Service Contract (Next.js → FastAPI)

Real, working example — see `app/api/debug/sentry-test/route.ts`:
```ts
// Next.js calls FastAPI with a short-lived service token (see the `security` skill's Service
// Tokens section — payload is `sub` only, no role/PII)
const token = await createServiceToken(clerkUser.id)
const res = await fetch(new URL('/process', env.FASTAPI_URL), {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'x-request-id': requestId,  // forwards the correlation id — see error-handling skill
  },
  body: JSON.stringify(payload),
})

// FastAPI always responds with the same { data } or { error } envelope
```

---

## Rules
- Never change the shape of an existing `data` field — additive changes only.
- Never return `null` where the client expects an array — return `[]`.
- Never leak internal field names, column names, or stack traces.
- Always `Content-Type: application/json` on every response.
- `404` — not `403` — for resource ownership failures (IDOR protection).
- A `429` always carries a `Retry-After` header computed from the rate limiter's own reset time
  (e.g. `Math.ceil((resetAt - Date.now()) / 1000)`), never a hardcoded guess — the limiter should
  expose its window's reset timestamp precisely so the route can compute this, not just a
  boolean `success`.
