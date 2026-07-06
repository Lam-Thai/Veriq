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
  NEXTAUTH_SECRET: z.string().min(32),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  INTERNAL_JWT_SECRET: z.string().min(32),
  FASTAPI_URL: z.string().url(),
})
export const env = EnvSchema.parse(process.env)
```

### FastAPI
```python
# app/core/config.py — pydantic-settings crashes on startup if vars missing
class Settings(BaseSettings):
    DATABASE_URL: str
    INTERNAL_JWT_SECRET: str
    ANTHROPIC_API_KEY: str
```

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
□ All `.env*` variants ignored except `.env.example` / `.env.*.example`
□ .gitignore is a backstop, not a control — pair it with a CI secret
  scanner (e.g. GitGuardian) gating every PR, since a file can be committed
  before a rule exists or a secret can land inside a tracked file
```

---

## Toolbelt Summary
| Purpose | Next.js | FastAPI |
|---|---|---|
| Validation | `zod` | `pydantic` |
| Auth | `next-auth` v5 | `python-jose` |
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
