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

### Validate numeric bounds against the DB column, not just `> 0`
A money field zod-validated only as `.positive()` still 500s (raw DB numeric-overflow) on a value
past the column's precision. Bound it to the column ceiling — `Decimal(10,2)` → `.max(99_999_999.99)`
— so an oversized amount is a clean 422, not an internal error. Same idea for string length vs.
`VarChar(n)` and page `limit` vs. a sane max.

### Pagination cursors are IDOR surface (Prisma keyset)
A `?cursor=<id>` param is request-controlled input pointing at a row. Prisma resolves the cursor row
by primary key **before** the query's `where` filter runs, so a cursor referencing another user's
row (or a non-existent id) behaves differently from an owned one — a faint existence oracle, and an
unparseable one 500s at the DB layer. Ownership-gate the cursor before handing it to `findMany`;
treat not-owned/not-found as an empty page, never an error:
```ts
if (cursor) {
  const owned = await db.expense.findFirst({ where: { id: cursor, userId }, select: { id: true } })
  if (!owned) return { data: [], nextCursor: null }
}
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

"Per `userId`, never IP" assumes a session exists — it's about not substituting a spoofable IP for
identity you actually have. On a genuinely **public** route there is no user id; key on the bearer
token instead, and see the "Public / Unauthenticated Routes" section below (which also covers the
RSC-page-that-writes case, where the thing needing a limit doesn't look like a route handler at
all).

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
  GEMINI_API_KEY: z.string().min(1).optional(), // optional — an additive AI feature must degrade, not 500 unrelated pages
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

**Corollary — any CI job that runs `next start` needs the full required env set, and a green local
e2e run does not predict it.** The build-phase fallback covers `next build` only; `next start` is a
normal production server where validation is strict by design. A workflow that supplies env only to
the build step will build fine and then 500 at request time on any route whose module graph reaches
`lib/env.ts`. This is *latent*: it stays invisible until a spec first exercises a dynamic page that
imports `lib/db.ts`, at which point a previously-green workflow goes red on a diff that didn't
touch CI. Locally it never reproduces, because `.env.local` quietly satisfies everything.

The fix is a **job-level** env block of placeholders covering every required field (not per-step —
a partial set is the whole failure mode), mirroring `lib/env.ts`'s own `BUILD_PLACEHOLDERS`. Real
example: `.github/workflows/playwright.yml`. Two things this does *not* buy you: a database
(`DATABASE_URL` points at nothing, so specs still can't touch real rows), and any excuse to set an
`.optional()` var — leave those unset in CI so the absent-path stays exercised.
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

### Adding a field to this env schema is a **two-place** edit, optional or not
`.optional()` in `EnvSchema` is only half of it. `BUILD_PLACEHOLDERS` is typed
`Record<keyof z.infer<typeof EnvSchema>, string>` — a mapped type over *every* schema key — so
omitting an entry is a **compile error** (`TS2739: ... is missing the following properties`), not a
silently-degraded build. Optional fields are not exempt: `GEMINI_API_KEY`, `SENTRY_DSN`,
`RESEND_API_KEY`, and `REPORT_SHARE_IP_SALT` all appear in that map today. The placeholder still has
to satisfy the field's own format constraint (an `.email()` field needs an email-shaped
placeholder, a `.min(16)` field needs 16+ chars), or `next build`'s fallback `EnvSchema.parse`
throws the moment it's used.

> This exact assumption — "optional fields skip `BUILD_PLACEHOLDERS`" — was written into a plan as
> fact and had to be corrected independently by two different agents who actually opened the file
> and hit the `tsc` error. The type makes it self-enforcing, so the failure is loud and immediate;
> the cost is only the wasted round-trip. Read `lib/env.ts` before asserting anything about its
> shape.

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
    ENVIRONMENT: str = "development"
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000"]
    INTERNAL_JWT_SECRET: str  # required — startup crashes if missing
    SENTRY_DSN: str | None = None
```

---

## Secrets and PII at Rest

> **Repo reality check**: both patterns below are real and working as of the report-sharing
> feature — `lib/report-shares.ts` (share tokens) and `lib/ip-privacy.ts` (viewer IPs). This is the
> first place in the repo that persists either a bearer credential or a network identifier, so
> these are the reference implementations, not aspirational sketches.

### Bearer tokens: store the hash, never the token
Any opaque value that *is* the access control for a resource — a share link, an invite code, an
API key you issue, a password-reset token — gets stored as `sha256(token)`, never raw. The raw
value exists only in the response that mints it and in whatever the user does with it afterward.

```ts
// Mint 256 bits — not randomUUID()'s ~122. Cheap to do, and this token is the entire
// access control for a real user's data over a long life, sent over channels you don't control.
export function mintShareToken(): string { return randomBytes(32).toString("base64url") }
export function hashShareToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}
// Lookup is a plain indexed equality match on the hash — findUnique({ where: { tokenHash } }).
// timingSafeEqual is for comparing two secrets *in your own memory*; it does not apply to a DB
// index lookup, and reaching for it here is over-engineering.
```
Sizing the token to the job: a request-scoped CSRF nonce bound to a cookie (`lib/connect-flow.ts`'s
`state`, `crypto.randomUUID()`) is a different risk class from a standalone bearer credential live
for 90 days — don't cargo-cult one's entropy budget onto the other. Store the hash in a
`@unique @db.VarChar(64)` column; per the `prisma` skill, `@unique` already creates the index, so
don't add a redundant `@@index`.

**Shape-validate before you hash or query.** Pin the token's exact format in a regex
(`/^[A-Za-z0-9_-]{43}$/` for 32 base64url bytes) and reject non-matching input *before* any DB
round-trip. Malformed input then costs zero queries — the cheapest possible defense on the one
lookup an unauthenticated caller can drive.

### Network identifiers: coarsen, **then** salt-hash — and store nothing if unsalted
Storing a viewer's IP verbatim in an access log is a PII decision, not a logging detail. The
working pattern (`lib/ip-privacy.ts`):
1. **Coarsen** — IPv4: zero the last octet; IPv6: truncate to the /64 prefix. This genuinely
   discards information before anything else happens.
2. **Salt-hash** — `sha256(REPORT_SHARE_IP_SALT + coarsenedIp)`, stored as hex.

Neither step alone is sufficient, and the reason is worth internalizing: hashing *without*
coarsening still fingerprints the exact IP (2^32 for IPv4 is brute-forceable), and coarsening
*without* a salt leaves a ~16M-value space that's trivially rainbow-tabled. The salt is what makes
the reduced space non-invertible.

**The critical rule: if the salt is unset, store `null` — never fall back to an unsalted hash.**
An unsalted hash of a small guessable space is not protection; a silent `""`-salt fallback looks
like it's doing something while doing nothing. This is the one case where "degrade gracefully"
means *store less*, not *store it anyway with a weaker guarantee*. Make the salt `.optional()` in
the env schema and have the helper return `null` — and unit-test that specific branch, because it's
the kind of thing a later refactor quietly "fixes" into a fallback.

A one-way digest also constrains the UI downstream: an owner-facing access log built on `ipHash`
can show *when* and *what browser* (user-agent, stored plain — it isn't the same privacy class and
the log needs it human-readable), but can never show a location. Don't let a UI imply otherwise.

---

## Public / Unauthenticated Routes

> **Repo reality check**: this app has three, and they're each public for a *different* reason —
> `app/api/webhooks/stripe/route.ts` (trust via signature verification), `app/verify/[token]/page.tsx`
> + `app/api/verify/[token]/download/route.ts` (trust via bearer token). Clerk gating in `proxy.ts`
> is **allowlist**-based (`createRouteMatcher(['/dashboard(.*)', '/connect(.*)'])`), so a new route
> is public by *default* — you make it public by doing nothing, which means nobody is forced to
> think about it. That's exactly why this checklist exists.

```text
□ Trust is established by something — signature, or a high-entropy token. "It's an
  unguessable URL" is only true if the token is actually high-entropy and hashed at rest
□ Not-found and malformed-input responses are BYTE-IDENTICAL. This is the one pair that
  must never be distinguishable — differing responses turn the route into an existence
  oracle. (Distinct expired/revoked messages are fine and good UX: the caller already
  holds a real token, so it grants them nothing they didn't have.)
□ No response — body, header, redirect, or error — reveals the owner's identity/email,
  or which internal resource is attached, in ANY state
□ Rate-limited on a key that exists without a session (see below)
□ `noindex` if it renders a page: `export const metadata = { robots: { index: false, follow: false } }`
□ Every state re-checks expiry/revocation independently. A direct sub-resource URL
  (a download endpoint) WILL be bookmarked and re-hit after the parent link lapsed —
  it must not rely on an earlier check from the page that linked to it
□ Logs carry internal ids only, never the token or a URL containing it
□ Verify it's genuinely outside the auth matcher — and that it wasn't accidentally
  caught by an existing pattern like `/dashboard(.*)`
```

### Rate-limit keys when there is no user
The "key per `userId`, never per IP" rule assumes a session exists — it's about not substituting a
spoofable IP for *real available identity*. On a genuinely public route there is no user id, so the
rule needs replacing rather than bending. The key must be **bounded**, and the raw bearer token is
not: `checkRateLimit` is an in-process `Map`, so keying on caller-supplied input lets anyone grow it
without limit (one entry per token tried), parks the credential in a long-lived structure, and
stops nothing — each fresh token gets a fresh bucket, which is exactly the enumeration shape you
were trying to throttle.

Use two stages, keyed on values you control:
```ts
// 1. Pre-lookup — bounded by real network sources, and it runs before any DB work.
//    Transient in-memory only; never logged, never persisted (see hashCoarseIp for storage).
const ip = clientIpFromHeaders(requestHeaders) ?? "unknown"
if (!checkRateLimit(`verify-lookup-ip:${ip}`, 30, 60_000).success) return ApiError.tooManyRequests(...)

const share = await getShareByToken(token)          // ...resolve + expiry/revocation checks...

// 2. Post-lookup — the resolved id is bounded (one per real row) and isn't a secret.
if (!checkRateLimit(`verify-download:${share.id}`, 20, 60_000).success) return ApiError.tooManyRequests(...)
```
Stage 1 is the one that's easy to omit and the one that matters most: without it the token lookup
is completely unthrottled, and a well-formed-but-nonexistent token sails past the shape regex
straight into the database. (FastAPI's `rate_limit_key` encodes the same precedence — verified JWT
`sub` first, `get_remote_address` only as a fallback.)

### An RSC page that writes to the DB is an endpoint, not just a render
A Server Component doing `await recordView(...)` on render is a write path reachable by anyone with
the URL — but it looks like a page, so it slips past a route-handler-shaped rate-limit review. This
was a real Medium finding on this repo's first public page: three of four new routes were limited,
and the unlimited one was the busiest. Gate the **write**, not the render — fail open on showing
content, fail closed on recording more of it:
```ts
const { success: viewRateOk } = checkRateLimit(`verify-view:${token}`, 20, 60_000)
if (viewRateOk) { /* ...record... */ } else { log.warn(...) }
```
Also keep such a write best-effort (`try/catch`, never blocking the render) and make sure the read
that feeds the page doesn't drag heavy columns with it — `include: { reportJob: true }` on a page
hit by every viewer will pull a multi-hundred-KB `Bytes` column it never renders. Select narrowly;
fetch the heavy payload only in the route that actually serves it.

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
| Password hash | `bcryptjs` (12 rounds) — *aspirational; not in the repo (auth is Clerk-only, no password hashing yet)* | `passlib[bcrypt]` — *aspirational; the backend has no password auth yet* |
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
- A bearer credential you issue (share link, invite code, reset token) is stored as its `sha256`
  digest, never raw — and a network identifier in an access log is coarsened *and* salt-hashed, or
  not stored at all. See "Secrets and PII at Rest".
- Every unauthenticated route gets the "Public / Unauthenticated Routes" checklist run against it
  before merge — including RSC pages, which are write endpoints whenever they touch the DB. Clerk
  gating here is allowlist-based, so nothing forces you to notice a route is public.
