# Skill: Error Handling
> Shared — TypeScript and Python patterns side by side

## Typed Result Pattern (TypeScript)
```ts
// lib/result.ts
type Result<T, E = AppError> = { ok: true; data: T } | { ok: false; error: E }
const ok   = <T>(data: T): Result<T>              => ({ ok: true, data })
const fail = <E extends AppError>(e: E): Result<never, E> => ({ ok: false, error: e })

// Usage
async function createInvoice(input: CreateInput): Promise<Result<Invoice>> {
  const exists = await db.invoice.findUnique({ where: { id: input.id } })
  if (exists) return fail(new ConflictError('Already exists'))
  const invoice = await db.invoice.create({ data: input })
  return ok(invoice)
}

const result = await createInvoice(input)
if (!result.ok) return result.error instanceof ConflictError
  ? ApiError.conflict()
  : ApiError.internal()
```

## Custom Error Classes (TypeScript)
```ts
// lib/errors.ts
export class AppError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = this.constructor.name
  }
}
export class NotFoundError  extends AppError { constructor(r = 'Resource') { super(`${r} not found`, 'NOT_FOUND') } }
export class ForbiddenError extends AppError { constructor() { super('Access denied', 'FORBIDDEN') } }
export class ConflictError  extends AppError { constructor(m: string) { super(m, 'CONFLICT') } }
```

## Custom Exceptions (Python)
```python
# app/core/errors.py
class AppError(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code

class NotFoundError(AppError):
    def __init__(self, resource: str = "Resource") -> None:
        super().__init__(f"{resource} not found", "NOT_FOUND")

class ConflictError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(message, "CONFLICT")

class ForbiddenError(AppError):
    def __init__(self) -> None:
        super().__init__("Access denied", "FORBIDDEN")
```

---

## Async Error Handling

### TypeScript — never float unhandled promises
```ts
// WRONG
fetchData().then(process)

// RIGHT
try {
  const data = await fetchData()
  process(data)
} catch (err) {
  logger.error({ err, context: 'fetchData' }, 'Failed')
  throw err  // re-throw if caller needs to handle
}
```

### Python — never swallow silently
```python
# WRONG
try:
    result = await service.create(data)
except Exception:
    pass

# RIGHT
try:
    result = await service.create(data)
except ConflictError:
    raise  # let global handler map to 409
except Exception:
    log.exception("create_invoice failed", user_id=user_id)
    raise  # re-raise — never swallow unknowns
```

### Bounding an external call with a timeout (TypeScript)
Never let a `fetch`/SDK call to something outside your process block a request indefinitely —
bound it with your own timeout, and always clear the timer so a normal completion doesn't leave
one dangling:
```ts
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 20_000)
try {
  const response = await someExternalCall({ signal: controller.signal })
  // ... use response
} catch (err) {
  // an aborted call rejects too — this same catch handles both a real failure and a timeout
  logger.error({ err, context: 'someExternalCall' }, 'Failed or timed out')
  throw err
} finally {
  clearTimeout(timeoutId)
}
```
The provider/API on the other end may only stop *your* wait, not its own processing or billing
for a request it already received — check the SDK's own docs on what aborting actually does
server-side before assuming it's a true cancellation.

### Cancelling a client-side fetch on unmount (React)
A component that fetches on mount and sets state from the response should cancel that fetch when
it unmounts — otherwise the request keeps running server-side for no reason, and (without a guard)
a late response can call `setState` after unmount:
```tsx
useEffect(() => {
  let cancelled = false
  const controller = new AbortController()

  async function load() {
    try {
      const res = await fetch('/api/thing', { signal: controller.signal })
      if (cancelled) return
      setState(await res.json())
    } catch {
      // an AbortError from the cleanup below also lands here — `cancelled` is already true by
      // then, so this guard skips setState rather than flashing an error post-unmount
      if (!cancelled) setState({ phase: 'error' })
    }
  }

  void load()
  return () => {
    cancelled = true
    controller.abort()
  }
}, [])
```
The `cancelled` flag and the `AbortController` do two different jobs — the flag stops a stale
response from touching state, the abort actually stops the in-flight request. Use both.

---

## Structured Logging

> **Repo reality check**: `pino` (Next.js) and `structlog` (FastAPI) are both real, installed, and
> wired up — `lib/logger.ts` (Next.js) and `app/core/logging.py` (FastAPI) exist and this is the
> pattern to import, not aspirational. Both sides also bind a request/correlation id
> (`x-request-id`, stamped in `proxy.ts` and forwarded on every Next.js → FastAPI service call) so
> one request's logs can be traced across both services. `console.error("[context] message", err)`
> is still what you'll find in routes this hasn't reached yet — replace it with `logger.error(...)`
> as you touch those routes, following the pattern in `app/api/report/route.tsx` /
> `app/api/checkout/route.ts` rather than leaving new ad hoc `console.*` calls.

### TypeScript (pino — real, `lib/logger.ts`)
```ts
// lib/logger.ts (already exists — this is what it looks like)
import pino from 'pino'
export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: { paths: ['token', 'authorization', 'headers.authorization', '*.token', '*.authorization'], remove: true },
})

// Per-request child carrying the x-request-id correlation id (see "Correlation IDs" below)
export function loggerFor(requestId: string) {
  return logger.child({ requestId })
}

// Usage in a route handler — always structured, never console.log
const requestId = (await headers()).get('x-request-id') ?? 'unknown'
const log = loggerFor(requestId)
log.error({ err, userId }, 'Invoice creation failed')
```

### Python (structlog — real, `app/core/logging.py`)
```python
# app/core/logging.py (already exists — this is what it looks like)
import structlog

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,  # required for request_id (below) to appear
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ],
)
log = structlog.get_logger()

# Usage
log.error("invoice.create.failed", user_id=user_id, error=str(e))
```

### Correlation IDs (real, both runtimes)
One request's logs are traceable across both services via an `x-request-id` header:
- `frontend/proxy.ts` stamps it on every request (reusing an inbound value if one already exists,
  e.g. from a load balancer, otherwise minting one with `crypto.randomUUID()`), and route handlers
  read it via `(await headers()).get('x-request-id')` to build a `loggerFor(requestId)` child.
- `backend/app/core/middleware.py`'s `request_context_middleware` does the FastAPI-side half: reads
  the same header (or mints one if this is the request's first hop), binds it via
  `structlog.contextvars.bind_contextvars(request_id=...)` for the request's lifetime (always
  cleared in a `finally`), and echoes it back on the response.
- Any Next.js → FastAPI call should forward the same id: `headers: { Authorization: ..., 'x-request-id': requestId }`
  (see `app/api/debug/sentry-test/route.ts` for the real example) — that's what makes one request's
  logs joinable across both services' JSON output.

**Log rules:**
- Always structured — object + message string, never bare string concat.
- Include: `userId`, `route`/`service`, `errorCode`, `durationMs` where relevant.
- `redact` PII and secrets from log output — never log passwords or tokens.
- `console.log` in TypeScript / `print()` in Python: dev only, remove before shipping.

---

## Error Tracking / APM (Sentry — real, both runtimes, optional DSN)

Both SDKs are installed and wired up, gated entirely on an optional DSN env var — unset in local
dev/CI, the SDK simply no-ops, so nothing here is a hard dependency to run the app.

### Next.js (`@sentry/nextjs`)
Uses the current `instrumentation.ts`/`instrumentation-client.ts` convention (Next 15+), not the
older `sentry.server.config.ts` trio — check the installed SDK version's own docs before assuming
otherwise, this is an area that moves between major versions.
```ts
// instrumentation.ts (already exists) — server-side, reads process.env directly (never `@/lib/env`
// here: this file must import cleanly even when unrelated required secrets are missing)
import * as Sentry from '@sentry/nextjs'
export function register() {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1, enabled: Boolean(process.env.SENTRY_DSN) })
}
export const onRequestError = Sentry.captureRequestError

// instrumentation-client.ts (already exists) — browser bundle, NEXT_PUBLIC_* only
Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) })
```
`next.config.ts` wraps its export in `withSentryConfig(nextConfig, { silent: true, ... })` for
build-time source-map upload — safe with zero extra config (no-ops without `SENTRY_AUTH_TOKEN`).
`app/global-error.tsx` (Next's root error boundary — different from a route-level `error.tsx`
below) calls `Sentry.captureException(error)` in a `useEffect`; it must render its own
`<html>`/`<body>` per Next's contract for this file.

### FastAPI (`sentry-sdk[fastapi]`)
```python
# app/main.py (already exists)
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=0.1,
    )
```
Unhandled exceptions are captured automatically by the integration — don't wrap every route in a
manual `sentry_sdk.capture_exception` call, that's what the integration exists to avoid.

### Proving it works
`app/api/debug/sentry-test/route.ts` (Next.js, signed-in-gated, 404 outside development) and
`backend/app/api/debug.py`'s `POST /debug/sentry-test` (FastAPI, service-token-gated, 404 outside
`ENVIRONMENT != "production"`) each deliberately raise — this is the real, working reference for
exercising a new error path end-to-end when you need to confirm APM is actually capturing.

---

## Global Error Boundary (Next.js)
Two different boundaries, not interchangeable:
- **Route-level `app/**/error.tsx`** — catches errors within one route segment, keeps the rest of
  the app shell (nav, etc.) intact. Use this for most routes.
- **Root `app/global-error.tsx`** (real, exists) — Next's catch-all when an error escapes every
  route-level boundary, including the root layout itself. Must render its own `<html>`/`<body>` —
  it replaces the entire tree, so it can't assume providers like `<ClerkProvider>` are mounted.

```tsx
// app/(app)/error.tsx — route-level
'use client'
export default function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { logger.error(error) }, [error])
  return (
    <div role="alert">
      <h2>Something went wrong</h2>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
```

## Rules
- Re-raise after logging when the caller needs to handle the error.
- Never expose stack traces or internal error messages to clients.
- All custom errors extend `AppError` / Python base class for consistent `instanceof` / `except` handling.
- Global handlers in both runtimes — not try/except in every route.
