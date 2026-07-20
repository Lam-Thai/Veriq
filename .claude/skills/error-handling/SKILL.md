---
name: error-handling
description: Side-by-side TypeScript and Python error handling — typed Result pattern, custom error/exception hierarchies, async error rules (never swallow), structured logging (pino/structlog) with redaction, and the Next.js error boundary. Use when handling failures or adding logging.
---

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

### TypeScript (pino)
```ts
// lib/logger.ts
import pino from 'pino'
export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: ['user.password', 'body.token', 'headers.authorization'],
})

// Usage — always structured, never console.log
logger.error({ err, userId, route }, 'Invoice creation failed')
```

### Python (structlog)
```python
# app/core/logging.py
import structlog

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)
log = structlog.get_logger()

# Usage
log.error("invoice.create.failed", user_id=user_id, error=str(e))
```

**Log rules:**
- Always structured — object + message string, never bare string concat.
- Include: `userId`, `route`/`service`, `errorCode`, `durationMs` where relevant.
- `redact` PII and secrets from log output — never log passwords or tokens.
- `console.log` in TypeScript / `print()` in Python: dev only, remove before shipping.

---

## Global Error Boundary (Next.js)
```tsx
// app/(app)/error.tsx
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
