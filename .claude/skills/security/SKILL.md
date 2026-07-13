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
```ts
// lib/service-token.ts
import { SignJWT, jwtVerify } from 'jose'

const secret = new TextEncoder().encode(process.env.INTERNAL_JWT_SECRET)

export async function createServiceToken(userId: string, role: string): Promise<string> {
  return new SignJWT({ sub: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('5m')  // short-lived — internal only
    .sign(secret)
}
```

---

## Rate Limiting

> **Repo reality check**: `@upstash/ratelimit` is not installed and no Redis/Upstash instance is
> configured anywhere in this repo as of this writing. Don't import `@/lib/ratelimit` — it
> doesn't exist yet. Until it's actually set up, note the rate-limiting gap explicitly in your
> output (e.g. "no rate limit applied — no infra installed yet") rather than silently omitting it
> or fabricating an import that will fail to resolve. The pattern below is the target shape for
> when that infra is added, not a claim it's already there.

### Next.js (Upstash)
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

### FastAPI (slowapi)
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/public-endpoint")
@limiter.limit("10/minute")
async def public_endpoint(request: Request):
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
| Auth | Clerk (`@clerk/nextjs`) | `python-jose` |
| Rate limit | `@upstash/ratelimit` | `slowapi` |
| Password hash | `bcryptjs` (12 rounds) | `passlib[bcrypt]` |
| Token sign/verify | `jose` | `python-jose` |
| Env validation | `zod` on `process.env` | `pydantic-settings` |

## Non-Negotiables
- No secret ever in client-side code.
- No secret ever hardcoded or committed.
- No PII in logs.
- 404 for ownership failures — never 403.
- `npm audit` / `pip audit` in CI at `high` level.
