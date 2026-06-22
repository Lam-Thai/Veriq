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
| `204` | Successful DELETE (no body) |
| `400` | Malformed syntax (JSON parse failed, bad param type) |
| `401` | Not authenticated |
| `403` | Authenticated but not permitted for this action |
| `404` | Not found — also use when user doesn't own the resource (IDOR protection) |
| `409` | Conflict — duplicate resource (unique constraint) |
| `413` | Payload too large (file upload) |
| `422` | Valid syntax, failed business validation |
| `429` | Rate limit exceeded |
| `500` | Internal server error — never leak details |

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
  tooManyRequests:  () => NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 }),
  internal:         () => NextResponse.json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }, { status: 500 }),
  unprocessable: (err: ZodError) => NextResponse.json({
    error: { code: 'VALIDATION_FAILED', message: 'Validation failed', fields: err.flatten().fieldErrors }
  }, { status: 422 }),
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof ZodError) return ApiError.unprocessable(err)
  if (err instanceof NotFoundError) return ApiError.notFound()
  if (err instanceof ConflictError) return ApiError.conflict()
  console.error('[API Error]', err)
  return ApiError.internal()
}
```

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
```ts
// Request: GET /api/invoices?page=0&perPage=20&sort=createdAt&order=desc

// Response:
{
  "data": [...],
  "meta": { "page": 0, "perPage": 20, "total": 143, "totalPages": 8 }
}
```

---

## Internal Service Contract (Next.js → FastAPI)

```ts
// Next.js calls FastAPI with a short-lived service token
const token = await createServiceToken(session.user.id, session.user.role)
const res = await fetch(`${process.env.FASTAPI_URL}/process`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
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
