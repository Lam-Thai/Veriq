---
name: security
description: Shared security toolbelt for both runtimes — input validation, auth cookies, service tokens, rate limiting, security headers, CORS, startup env validation, file-upload safety, and CI/CD supply-chain hardening (GitHub Actions workflows, git hooks, secret hygiene). Use when hardening auth/API/data code, writing a workflow or git hook, or doing a security pass.
---

# Skill: Security
> Shared — applies to both Next.js and FastAPI

## Input Validation

### Next.js (zod)
```ts
const Schema = z.object({
  email: z.string().email().max(254),
  amount: z.number().positive().max(1_000_000),
})

const parsed = Schema.safeParse(body)
if (!parsed.success) return ApiError.unprocessable(parsed.error)
```

### FastAPI (Pydantic — automatic on route handlers)
```python
class CreateInvoiceRequest(BaseModel):
    amount: Decimal = Field(gt=0, le=1_000_000)
    currency: str = Field(min_length=3, max_length=3, pattern="^[A-Z]{3}$")
    note: str | None = Field(None, max_length=1000)
```

### Fixed-point sanitization for free-text fields (not just shape validation)
Validating a field's *shape* (zod/pydantic above) is separate from sanitizing its *content* when
that content will be re-embedded somewhere else (HTML, a prompt, a shell command). A single-pass
`.replace()` of a repeating pattern can leave a match behind on crafted nested/overlapping input —
e.g. `raw.replace(/<[^>]*>/g, '')` turns `"<<script>script>"` into `"<script>"`, not `""`, because
removing the inner tag exposes a new one that the single pass already finished scanning past. This
is CodeQL's `js/incomplete-multi-character-sanitization`, and a real finding this repo shipped and
then fixed. Loop any such replace to a fixed point instead:
```ts
let sanitized = raw
let previous: string
do {
  previous = sanitized
  sanitized = sanitized.replace(/<[^>]*>/g, "")
} while (sanitized !== previous)
```
See the `ai-integration` skill's "Input Sanitization" section for the full real example
(`lib/ai-sanitize.ts`).

---

## Authentication Cookies (Next.js)
This repo's frontend uses Clerk (`@clerk/nextjs`) for the user session — Clerk's SDK owns
cookie creation, rotation, and flags entirely; never hand-roll `Set-Cookie` logic for the
session itself. The flags below apply to any *other* first-party cookie your own code sets
(e.g. CSRF state, feature flags):
```
Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800
```
- `HttpOnly`: no JS access
- `Secure`: HTTPS only
- `SameSite=Lax`: CSRF protection on top-level navigation
- Expiry: 7 days max. Access tokens: 15min. Refresh: 7d.

## Service Tokens (Next.js → FastAPI)

> **Repo reality check**: this pattern is real, installed, and has a working end-to-end caller —
> `frontend/lib/service-token.ts` (`createServiceToken`, `jose`) signs, `backend/app/auth.py`
> (`verify_service_token`/`get_current_user_id`, `python-jose`) verifies. `INTERNAL_JWT_SECRET` is
> a required field in both `frontend/lib/env.ts` and `backend/app/core/config.py` — it must be the
> same literal value in both `.env` files. `frontend/app/api/debug/sentry-test/route.ts` is the
> first real caller (it mints a token and calls FastAPI's `POST /debug/sentry-test`) — copy that
> shape for the next Next.js → FastAPI call rather than re-deriving the pattern from scratch.

```ts
// lib/service-token.ts — real, working version (payload is `sub` only, no role/PII)
import { SignJWT } from 'jose'
import { env } from '@/lib/env'

const secret = new TextEncoder().encode(env.INTERNAL_JWT_SECRET)

export async function createServiceToken(clerkUserId: string): Promise<string> {
  return new SignJWT({ sub: clerkUserId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')  // short-lived — internal only
    .sign(secret)
}
```

---

## Rate Limiting

> **Repo reality check**: `@upstash/ratelimit`/Redis is still not installed as of this writing —
> for a *multi-instance* deployment you'd want it, since the pattern below only coordinates within
> one process. But `lib/rate-limit.ts` **does now exist and is real, working, in-process code**
> (built for the AI income-narrative feature) — a module-scoped `Map`-based fixed-window limiter
> keyed by an arbitrary string. Use it (`import { checkRateLimit } from '@/lib/rate-limit'`)
> instead of either fabricating an Upstash import that isn't installed, or reinventing another
> in-process limiter from scratch. Swap it for Upstash once real multi-instance/serverless scale
> makes the single-instance limitation (state resets on redeploy/cold start, doesn't coordinate
> across instances) actually matter.

### Next.js — real, working in-process limiter (current default)
```ts
// lib/rate-limit.ts (already exists — this is what it looks like)
export type RateLimitResult = { success: boolean; remaining: number; resetAt: number }

// In route: limit per userId (not IP — spoofable). `resetAt` (epoch ms) is when the caller's
// current window ends — always derive a 429's Retry-After header from it, never guess a value.
const { success, resetAt } = checkRateLimit(`feature:${clerkUser.id}`, 10, 60_000)
if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000))
```
If the thing you're rate-limiting itself has a **shared** quota across all users — e.g. a
free-tier third-party API billed/limited per project, not per caller — add a second, unkeyed
check (same literal key for every request) alongside the per-user one; a per-user limit alone
does nothing to stop many different users collectively exceeding a quota that isn't actually
partitioned by user. See the `ai-integration` skill's "Free-tier realities" section for the
concrete example this pattern came from.

**Cleanup cost**: if the limiter does opportunistic cleanup of expired entries once its map grows
past a threshold, throttle that sweep (e.g. "at most once per N seconds") rather than running a
full scan on every call once you're over the threshold — otherwise, for as long as the map stays
above threshold, *every single call* pays an O(n) scan even though most entries haven't expired
yet. `lib/rate-limit.ts` does this with a `lastCleanupMs` guard.

### Next.js (Upstash — target shape once multi-instance scale needs it)
```ts
// lib/ratelimit.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

export const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, '10 s'),
})

// In route: limit per userId (not IP — spoofable)
const { success } = await ratelimit.limit(session.user.id)
if (!success) return ApiError.tooManyRequests()
```

### FastAPI (slowapi — real, installed, wired up)
`backend/app/core/rate_limit.py` is the real, working precedent — reuse it, don't reinvent a
`key_func`. Its `rate_limit_key` decodes the caller's service-token JWT and keys on the verified
`sub` (never the header value un-verified), falling back to `get_remote_address` only when no/an
invalid token is present — the same "identity over IP" principle as the Next.js limiter, applied
to a `Bearer` token instead of a session cookie. `rate_limit_exceeded_handler` returns this repo's
`{ error: { code: "RATE_LIMITED", message } }` envelope (not slowapi's default bare-string body),
with the `Retry-After`/`X-RateLimit-*` headers slowapi already sets.

```python
# app/core/rate_limit.py (already exists — this is what it looks like)
from slowapi import Limiter
from app.core.rate_limit import rate_limit_key  # decodes JWT sub, falls back to remote address

limiter = Limiter(key_func=rate_limit_key)

# app/main.py — wire once
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# In a route — after the auth dependency, same as the Next.js pattern
@router.post("/endpoint")
@limiter.limit("10/minute")
async def endpoint(request: Request, user_id: str = Depends(get_current_user_id)):
    ...
```

---

## Security Headers (Next.js — next.config.ts)
```ts
[
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; frame-ancestors 'none'" },
]
```

## FastAPI CORS (explicit origins only)
```python
CORSMiddleware(
    allow_origins=["https://yourdomain.com"],  # never "*"
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
```

---

## Env Validation at Startup

### Next.js
```ts
// lib/env.ts
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  CLERK_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  INTERNAL_JWT_SECRET: z.string().min(32),
  FASTAPI_URL: z.string().url(),
})
export const env = EnvSchema.parse(process.env)
```
A naive version of this throws during `next build` too, not just at real runtime — `next
build`'s "Collecting page data" step imports every route module to statically analyze it, which
runs that module's top-level code (including any client singleton constructed from `env.*` at
module scope, e.g. a Stripe or S3 client) even though no handler is ever invoked. That makes
every secret required just to run `next build`, which breaks in any CI build step or fresh clone
that doesn't have every real secret available — a real incident in this repo (a required Stripe
var broke `npm run build` in the E2E CI job, which never actually calls Stripe). The fix: only
relax validation for the literal `next build` CLI process, using the phase marker Next.js itself
sets, never for anything that actually serves a request.
```ts
// lib/env.ts — real, working version of this pattern
const isProductionBuildPhase = process.env.NEXT_PHASE === "phase-production-build"
// ^ Next.js sets this only for the `next build` CLI process itself
//   (node_modules/next/dist/build/index.js) — `next start`/`next dev`/a real deployment are
//   separate process launches where it's never set, so this can't leak into anything real.

function loadEnv() {
  const parsed = EnvSchema.safeParse(process.env)
  if (parsed.success) return parsed.data
  if (!isProductionBuildPhase) throw parsed.error   // real runtime — fail loudly, always

  // Build-time-only placeholders, each still satisfying its own format constraint so a
  // module-scope client construction doesn't throw during static analysis. Real values win
  // whenever present — this only fills in what's genuinely missing.
  return EnvSchema.parse({ ...BUILD_PLACEHOLDERS, ...process.env })
}
export const env = loadEnv()
```
Verify this actually works both ways before trusting it: temporarily rename `.env.local` aside
and confirm `next build` now succeeds (with a visible warning) *and* that `next start` still
throws for a route that genuinely needs the missing var — don't just trust the logic on paper.
See also "Third-Party SDK Production Verification" below for the related-but-different Clerk
case, where the SDK itself (not your own zod schema) degrades ungracefully outside `next dev`.

### Required vs. optional secrets in one monolithic schema
`EnvSchema.safeParse(process.env)` validates **every field together in one call** — a real bug
this repo hit: `lib/env.ts` is imported transitively by `lib/db.ts`, which nearly every
authenticated page touches, so adding a new *required* field for one specific, genuinely optional
feature (an additive AI narrative card) 500'd the entire dashboard page whenever that one field
was unset — not just the feature that needed it. `next build`'s build-phase placeholder mechanism
above doesn't help here; that only relaxes validation for the literal build step, not for
`next dev`/`next start`/a real deployment, which is exactly when this bug fired.

The fix: if a feature's own spec says it must be additive/non-blocking, its secret must be
`.optional()` in the schema, with the feature's own code checking for its presence at the point of
use and degrading gracefully — not the shared env module deciding for it at process boot:
```ts
GEMINI_API_KEY: z.string().min(1).optional(),   // optional — this feature must degrade, not 500 unrelated pages
```
```ts
// lib/ai.ts — construct with `?? ""`, never `undefined`, so this module-scope statement can't
// throw on import either; the real check happens in the service, before attempting the call.
export const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY ?? "" })
export function isAiConfigured(): boolean { return Boolean(env.GEMINI_API_KEY) }
```
Ask, for every new required field you add to a shared env schema: "if this is unset, does *only*
the feature that needs it break, or does it take unrelated pages down with it?" If the latter and
the feature isn't supposed to be load-bearing for the rest of the app, it needs to be optional.

### `server-only` guard on modules that read secret env vars
Any module that imports `env` from `lib/env.ts` to read a server secret (not a `NEXT_PUBLIC_*`
value) and could plausibly be imported by mistake from a `"use client"` file should start with
`import "server-only"` (the `server-only` package, a transitive Next.js dependency — no install
needed). This turns an accidental client-side import into a build error instead of a silent
secret leak into the browser bundle. Real example: `lib/stripe-price-map.ts` reads
`env.STRIPE_PRICE_ID_PRO` and is guarded this way since it's plausible a UI component could
import it directly instead of going through the API route.

### FastAPI
```python
# app/core/config.py — pydantic-settings crashes on startup if vars missing
class Settings(BaseSettings):
    DATABASE_URL: str
    INTERNAL_JWT_SECRET: str
    ANTHROPIC_API_KEY: str
```

---

## Third-Party SDK Production Verification

Some SDKs (Clerk is the concrete example here) validate required config lazily, at
request-handling time, not at build time. `next build` succeeding proves the code compiles —
it proves nothing about whether the app can serve a single request in production. Clerk's
`ClerkProvider`/`clerkMiddleware` throw `Missing publishableKey` and 500 on **every request**
under `next start` without real keys, because its zero-config "keyless mode" is deliberately
dev-only (`next dev`) and disabled in production and CI.

Before calling any such integration done:
- Run the actual production path locally: `CI=true npm run build && CI=true npm run start`,
  then hit a route — not just `npm run build`.
- If a CI workflow runs a production build/start (e.g. an e2e job), confirm the required
  secrets are wired as repo secrets under the **exact** names the workflow reads. A secret
  named differently than the env var the workflow maps it to is a silent, easy-to-miss failure
  mode — prefer naming the GitHub Actions secret identically to the runtime env var.
- Consider a preflight CI step that fails fast with a clear message if a required secret is
  empty, rather than letting the app 500 in a loop until the job times out.

---

## File Upload Security
- Validate `content_type` against allowlist.
- Validate magic bytes — never trust the `Content-Type` header alone.
- Enforce size limits before reading into memory.
- Derive storage keys from hash — never use the client's filename directly.

---

## CI/CD & Supply-Chain Security

Applies to anything under `.github/workflows/` and any git hook (Husky, pre-commit).
These are the patterns this repo's workflows (`gitguardian.yml`, `codeql.yml`,
`playwright.yml`) and `.husky/pre-push` were built and CodeRabbit-reviewed against —
treat them as required, not optional.

### GitHub Actions workflows

```text
□ Third-party actions pinned to a full commit SHA, not a mutable tag/branch
    uses: GitGuardian/ggshield-action@da20be0...30b # v1.52.2  ← SHA first, tag as a comment
□ Top-level `permissions: contents: read`; broaden only on the specific job
  that needs it (e.g. `security-events: write` for SARIF upload), with a
  comment explaining why
□ `actions/checkout` sets `persist-credentials: false` unless the job
  actually needs to push
□ Trigger on `pull_request`, never `pull_request_target`, for anything that
  checks out and runs untrusted fork code or has secrets in scope
□ A step that needs a secret is guarded so it no-ops (not fails) on forked
  PRs, where the secret is never available:
    if: github.event.pull_request.head.repo.full_name == github.repository
□ `concurrency: { group: <workflow>-<pr>, cancel-in-progress: true }` so
  superseded pushes don't stack redundant/racing runs (also avoids wasted
  scans/minutes on paid third-party actions)
□ `timeout-minutes` set on every job so a hung step can't burn CI time
  indefinitely
□ Env vars sourced from `${{ secrets.X }}` are named identically to the repo
  secret they read — a translation layer between secret name and consumed
  var name is an easy, silent way to ship a workflow that always fails
```

### Git hooks (Husky, pre-commit, etc.)

```text
□ No remote-fetch-and-execute pattern anywhere in the hook or its scripts —
  no `curl ... | sh`, no `wget` piped into a shell, no dynamically fetched
  script. Only invoke locally installed, version-controlled tooling.
□ Every path/variable expansion in the hook script is double-quoted
  ("$var", not $var) — hooks run with the developer's full shell privileges
□ The hook script itself (e.g. `.husky/pre-push`) is committed and reviewed
  like any other code; generated wrapper machinery (e.g. `.husky/_/`) is
  regenerated by the `prepare` script and self-gitignored — never hand-edit
  or commit it
□ On failure: exit non-zero, print which check failed and how to fix it
  (e.g. the exact command to set up a missing local environment) — a
  swallowed or unclear failure just trains developers to `--no-verify`
□ Document the intentional escape hatch (`git push --no-verify`) rather than
  leaving developers to discover it under pressure
```

### Secret hygiene

```text
□ .gitignore covers key/cert/credential file patterns: *.pem, *.key, *.p12,
  *.pfx, *.crt, *credentials*.json, *service-account*.json
□ All `.env*` variants ignored except `.env.example` / `.env.*.example` —
  verify the exception actually works with `git check-ignore -v path/to/.env.example`.
  A blanket `.env*` rule with no `!.env.example` negation silently blocks the
  template from ever being committed, which looks like "it's fine, nothing's
  tracked" right up until someone needs the template and it isn't there
□ .gitignore is a backstop, not a control — pair it with a CI secret
  scanner (e.g. GitGuardian) gating every PR, since a file can be committed
  before a rule exists or a secret can land inside a tracked file
```

---

## Toolbelt Summary
| Purpose | Next.js | FastAPI |
|---|---|---|
| Validation | `zod` | `pydantic` |
| Auth (user session) | Clerk (`@clerk/nextjs`) | n/a — FastAPI never talks to Clerk directly |
| Auth (service call) | `jose` (`lib/service-token.ts`, real) | `python-jose` (`app/auth.py`, real) |
| Rate limit | `lib/rate-limit.ts` (in-process, real) → `@upstash/ratelimit` at multi-instance scale | `slowapi` (`app/core/rate_limit.py`, real) |
| Password hash | `bcryptjs` (12 rounds) | `passlib[bcrypt]` |
| Structured logging | `pino` (`lib/logger.ts`, real) | `structlog` (`app/core/logging.py`, real) |
| Error tracking / APM | `@sentry/nextjs` (real, optional `SENTRY_DSN`) | `sentry-sdk[fastapi]` (real, optional `SENTRY_DSN`) |
| Env validation | `zod` on `process.env` | `pydantic-settings` |

## Non-Negotiables
- No secret ever in client-side code.
- No secret ever hardcoded or committed.
- No PII in logs.
- 404 for ownership failures — never 403.
- `npm audit` / `pip audit` in CI at `high` level.
- Every external network call (third-party API, AI provider, webhook forward) has an explicit
  timeout (`AbortController` in TS, `httpx` timeout in Python) — don't rely on the callee's own
  timeout behavior, and always clear the timer/task on completion so a normal response doesn't
  leave one dangling.
- A required field in a shared, monolithically-validated env schema must actually need to be
  required for the *whole app* to function — an additive/optional feature's secret belongs in
  `.optional()`, checked at its own point of use (see "Required vs. optional secrets" above).
