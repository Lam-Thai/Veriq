---
name: testing
description: Use when writing unit, integration, or E2E tests for either runtime — vitest/Playwright for Next.js, pytest + httpx for FastAPI. Covers happy/auth/validation/404/IDOR cases, factories, and testing observable behavior over implementation.
model: sonnet
---

# Agent: Test Writer
> Runtime: Both (vitest for Next.js · pytest for FastAPI)

## When to Use This Agent
Writing unit tests, integration tests, or E2E tests for either runtime.

---

## Repo Reality (read before copying any example below)

The examples in this doc are the *target* patterns. What actually exists today:

- **Unit tests are wired up.** `vitest` is installed; `frontend/vitest.config.ts` sets the node
  environment, mirrors tsconfig's `@/` alias, and scopes collection to `*.test.ts(x)` (it excludes
  `e2e/**` so it never grabs the Playwright `*.spec.ts` files). Run with `npm run test`
  (`vitest run`) or `npm run test:watch`. `.husky/pre-push` runs `npm run test` before the build,
  so a failing unit test blocks the push.
- **Reference to copy:** `frontend/lib/income-calculators.test.ts` — colocated `*.test.ts`,
  explicit `import { describe, it, expect } from "vitest"`, pure-function coverage with `@/` imports
  and fixture factories. Prefer testing the pure lib layer (`lib/*`) directly.
- **Component/DOM tests are supported now.** `@testing-library/react`, `@testing-library/dom`,
  `@testing-library/user-event`, and `jsdom` are installed (`frontend/package.json`, devDependencies).
  The global vitest environment stays `node` (`frontend/vitest.config.ts` is unchanged) — a
  DOM-dependent component test opts into jsdom **per-file** with a `// @vitest-environment jsdom`
  docblock as its first line, rather than flipping the shared config. Auto-cleanup isn't wired (test
  globals are off), so call `cleanup` in an `afterEach` manually. Reference:
  `frontend/components/ui/disclosure.test.tsx`.
- **The integration-test harness EXISTS — it's Playwright-based, not vitest-based.** Real Postgres
  runs in CI (`.github/workflows/playwright.yml` has a `postgres:17-alpine` service container with
  `npx prisma migrate deploy` applied before the build) and locally
  (`docker compose --profile postgres up`, host port 5433 — see `docker-compose.yml` and
  `frontend/.env.test.example`). Local run: `npm run db:test:up`, `npm run db:test:migrate`,
  `npm run test:e2e:db` (that last one is `dotenv -e .env.test.local -- playwright test`; a bare
  `npm run test:e2e` won't have a `DATABASE_URL`). What exists:
  - `@/test/factories/user` — two flavours, and picking the right one matters:
    - `createTestUser()` / `deleteTestUser(userId, clerkId)` creates the Clerk user *and* the
      internal `User` row; nothing in the app stitches those together (no webhook —
      `getInternalUserId` only ever does a `findUnique`), so the factory is the only place that
      does. Use it **only when the spec actually signs in.**
    - `createTestDbUser()` / `deleteTestDbUser(userId)` creates just the `User` row, with a
      synthetic `dbonly_*` `clerkId` that resolves to nothing. Use it whenever the spec never calls
      `signInAs` — every public `/verify/[token]` case, and the *owner* side of an IDOR test where
      only the attacker authenticates. The shared Clerk instance's Backend API is rate-limited and
      the suite has already exhausted it once, so spending a real Clerk user on a test that never
      authenticates is the thing to avoid.
  - `@/test/factories/report-job` — `createTestReportJob(userId, overrides?)`, defaults to `READY`
    with placeholder `pdfData`.
  - `@/test/factories/share` — `createTestShare(reportJobId, userId, overrides?)`, returns the raw
    token; pass a past `expiresAt` or a `revokedAt` for those states.
  - `@/test/helpers/db` — `testDb` (a Prisma client separate from `@/lib/db`, see the `server-only`
    note below) and `resetDb()`, guarded by an allowlist that refuses to run against anything but a
    known test database.
  - `e2e/helpers/auth` — `createClerkTestUser()`, **`signInAs(page, { email })`** (not `loginAs`),
    `deleteClerkTestUser(clerkId)`. `e2e/global.setup.ts` runs `clerkSetup()` as a project-based
    setup; a function-based `globalSetup` would *not* propagate `CLERK_FAPI`/`CLERK_TESTING_TOKEN`
    to the workers.
  - `e2e/helpers/db-test` — **import `test`/`expect` from here, not `@playwright/test`**, in any
    DB-backed spec. It's a `test.extend` with an `auto` fixture that calls `resetDb()` before each
    test; that truncation is the isolation mechanism.
  - `@/test/helpers/client` (a `testClient` HTTP wrapper) is the one piece that still does **not**
    exist — DB-backed specs make real HTTP calls via Playwright's `page.request` / `request` fixture
    instead.

  Two config rules that bite if missed: a new DB-backed spec filename must be added to
  `DB_BACKED_SPECS` in `playwright.config.ts` (that list is what routes it into the serial,
  single-worker `chromium-db` project — everything else stays fully parallel in `chromium`), and
  Clerk sign-in must use the **email/ticket** overload (`clerk.signIn({ page, emailAddress })`).
  The `{ strategy: "password" }` overload was tried and fails against this repo's shared CI Clerk
  instance — every authenticated request comes back 401 — because it depends on password auth being
  enabled as a first factor, which nothing here guarantees.
- **The only `@/lib/db` mock is a narrow hand-rolled fake — and that's the ceiling, not a
  starting point.** `lib/report-shares.test.ts` does `vi.mock("@/lib/db", () => ({ db: mockDb }))`
  with a small in-memory object mimicking `updateMany`'s zero-count semantics, to prove exactly one
  of two concurrent callers wins the first-claim race. That's a legitimate unit test of the
  *branch logic*, and it's the pattern to copy for a similarly narrow seam. It is emphatically
  **not** a test of the Postgres row lock — annotate any such fake so nobody later reads it as
  proof the DB guarantee holds.
- **Fidelity ceiling (of the *vitest* layer):** a hand-rolled fake can only ever prove your
  branching is right, never that Postgres does what you think (advisory locks, cross-connection row
  locks, real transaction isolation, cascade behaviour, constraint violations). Ownership checks,
  cap enforcement, and cursor gating that live inside a `db.$transaction` are integration-only —
  but that is no longer a reason to leave them uncovered: write them as a DB-backed Playwright spec
  against the harness above. `e2e/sharing-idor.spec.ts`, `sharing-concurrency.spec.ts`,
  `sharing-rate-limit.spec.ts`, and `sharing-verify.spec.ts`'s real-share-state cases are the
  worked examples (IDOR, the advisory-locked cap-of-10 under 15 concurrent POSTs, exactly-once
  first-view claim, 429 + `Retry-After`). Keep the pure layer in vitest (zod schemas,
  token/regex/hash helpers, calculators); never downgrade an IDOR test into something that doesn't
  exercise IDOR. Building out a general Prisma-mocking framework is still out of scope.
- **`import "server-only"` must be mocked under Vitest.** Its no-op variant is selected via the
  `react-server` export condition that Next's bundler sets; under plain Node it resolves to the
  throwing `index.js`. Any test touching a `server-only` module needs `vi.mock("server-only", ...)`
  alongside the usual `@/lib/env` / `@/lib/logger` mocks — see `lib/email.test.ts`.
- **`userEvent.setup()` installs its own `navigator.clipboard` stub**, silently clobbering a
  clipboard mock installed before it. Order matters — see `components/ui/copy-button.test.tsx`.
- **A green local `npm run test:e2e` does not predict a green CI run.** Locally `.env.local`
  satisfies the whole env schema; in CI only what the workflow explicitly sets exists, and
  `next start` validates strictly (the build-phase placeholder fallback does not apply at runtime).
  A spec that renders a *dynamic page importing `lib/db.ts`* is the first thing to expose a gap
  there — it 500s, and your assertion fails on a missing element rather than on anything to do with
  your test. **If a new spec fails in CI but passes locally, check the workflow's env block before
  touching the spec.** See the `security` skill's "Env Validation at Startup" corollary.
- **Pick the e2e script by what the spec needs, and never run a bare `npx playwright test`.**
  Locally, anything in the `chromium-db` project (the `DB_BACKED_SPECS` list) needs
  `npm run test:e2e:db` — that's `dotenv -e .env.test.local -- playwright test`, which is what puts
  a *test* `DATABASE_URL` in scope. `npm run test:e2e` is only right for the specs that touch
  neither the database nor a session (`smoke`, `pricing`, `scroll-out`). Get it wrong and
  `test/helpers/db.ts`'s guard stops the run rather than letting it touch the wrong database, so
  this fails loudly, not silently — but reach for the right one. In CI the plain `npm run test:e2e`
  is correct: the workflow supplies `DATABASE_URL` at job level for every step. Either way, never
  `npx playwright test` — `npx` may fetch a different Playwright version than the installed
  `@playwright/test` and fail with a confusing "did not expect test.describe() to be called here".

---

## Skills
Consult these skills (`.claude/skills/<name>/SKILL.md`) before and while working:

| Skill | Purpose |
|---|---|
| `typescript` | TypeScript test typing, zod schema testing |
| `python` | pytest patterns, fixtures, async testing |
| `api-contracts` | Response envelope shape assertions (`data`/`error`) |
| `error-handling` | Testing error paths, failure modes |
| `engineering-standards` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer.
- Unit, integration, E2E — or a mix, for this piece of work?
- Existing test factories / test DB setup to reuse, or does one need to be created first?
- Core paths only (happy / auth / validation / 404), or fuller edge-case coverage expected?

---

## Task Protocol
1. Identify the test type: unit, integration, or E2E.
2. List all cases before writing code: happy path, edge cases, failure cases, auth cases.
3. Write tests. One behavior per `it()` / `def test_`.
4. Verify: testing observable behavior, not internal implementation.

---

## Test Type Decision

| What | Type | Next.js tool | FastAPI tool |
|---|---|---|---|
| Pure functions, schemas, utils | Unit | vitest | pytest |
| API routes + DB | Integration | vitest + test DB | pytest + httpx + test DB |
| Critical user flows | E2E | Playwright | — |

---

## Next.js: Unit Test

```ts
// lib/pricing.test.ts
import { describe, it, expect } from 'vitest'
import { calculateTotal } from './pricing'

describe('calculateTotal', () => {
  it('sums line items correctly', () => {
    expect(calculateTotal([{ qty: 2, price: 50 }, { qty: 1, price: 30 }])).toBe(130)
  })

  it('returns 0 for empty items', () => {
    expect(calculateTotal([])).toBe(0)
  })

  it('throws on negative quantity', () => {
    expect(() => calculateTotal([{ qty: -1, price: 10 }])).toThrow('Quantity must be positive')
  })
})
```

## Next.js: Integration Test (API route)

> **Real pattern — this is how the shipped harness does it.** Integration tests here are
> *Playwright* specs making real HTTP calls against a real `next start` + real Postgres, not vitest
> tests importing route handlers. There is no `testClient`; use `page.request` (authenticated —
> carries the Clerk session cookie) or the `request` fixture (unauthenticated/public routes). The
> filename must be listed in `DB_BACKED_SPECS` in `playwright.config.ts`.
> See `e2e/sharing-idor.spec.ts` for the full version of the below.

```ts
// e2e/invoice-idor.spec.ts
import { test, expect } from './helpers/db-test' // NOT @playwright/test — this adds resetDb()
import { createTestUser, createTestDbUser, deleteTestUser, deleteTestDbUser } from '@/test/factories/user'
import { signInAs } from './helpers/auth'
import { testDb } from '@/test/helpers/db'

test("another user's invoice returns 404, not 403", async ({ browser }) => {
  // Owner never signs in — it only needs to own the row — so it costs no Clerk user.
  const owner = await createTestDbUser()
  // Nested scopes, not one flat try/finally over both: the attacker is created *inside* the
  // owner's cleanup scope, so a throwing createTestUser can't strand the owner, and neither
  // teardown can block the other. The attacker's matters most — it's the only Clerk identity,
  // and resetDb()'s TRUNCATE cannot reclaim those.
  try {
    const attacker = await createTestUser()
    try {
      const invoice = await testDb.invoice.create({ data: { userId: owner.userId, total: 500 } })

      // Separate context so the attacker's cookies can never reuse the owner's session.
      // Relative URLs still resolve here: browser.newContext() does inherit the config baseURL.
      const ctx = await browser.newContext()
      try {
        const page = await ctx.newPage()
        await signInAs(page, attacker)

        const res = await page.request.delete(`/api/invoices/${invoice.id}`)
        expect(res.status()).toBe(404) // 404, never 403 — don't reveal existence
      } finally {
        await ctx.close()
      }

      // Ground truth from Postgres: prove the response wasn't just lying about the side effect.
      const after = await testDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
      expect(after.deletedAt).toBeNull()
    } finally {
      await deleteTestUser(attacker.userId, attacker.clerkId)
    }
  } finally {
    await deleteTestDbUser(owner.userId)
  }
})
```

<details>
<summary>Superseded vitest shape — do NOT reach for this</summary>

```ts
// `testClient` and `createTestSession` were always illustrative and were never built.
// Don't import them. Use the Playwright pattern above for anything touching the DB or a session.
import { testClient } from '@/test/helpers/client'          // ✗ does not exist
import { createTestSession } from '@/test/factories/user'   // ✗ does not exist
```

</details>

## FastAPI: Unit Test

```python
# tests/services/test_pricing.py
import pytest
from decimal import Decimal
from app.services.pricing import calculate_total, LineItem


def test_sums_line_items():
    items = [LineItem(qty=2, price=Decimal("50")), LineItem(qty=1, price=Decimal("30"))]
    assert calculate_total(items) == Decimal("130")


def test_returns_zero_for_empty_items():
    assert calculate_total([]) == Decimal("0")


def test_raises_on_negative_quantity():
    with pytest.raises(ValueError, match="Quantity must be positive"):
        calculate_total([LineItem(qty=-1, price=Decimal("10"))])
```

## FastAPI: Integration Test

```python
# tests/routers/test_invoices.py
import pytest
from httpx import AsyncClient
from app.main import app
from tests.factories import make_service_token, make_invoice


@pytest.mark.anyio
async def test_get_invoice_returns_own_invoice():
    async with AsyncClient(app=app, base_url="http://test") as client:
        token = make_service_token(user_id="user-123")
        invoice = await make_invoice(user_id="user-123")

        res = await client.get(
            f"/invoices/{invoice.id}",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert res.status_code == 200
    assert res.json()["data"]["id"] == invoice.id


@pytest.mark.anyio
async def test_get_invoice_returns_404_for_other_users_invoice():
    async with AsyncClient(app=app, base_url="http://test") as client:
        token = make_service_token(user_id="user-999")  # different user
        invoice = await make_invoice(user_id="user-123")

        res = await client.get(
            f"/invoices/{invoice.id}",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert res.status_code == 404  # not 403 — don't reveal existence


@pytest.mark.anyio
async def test_missing_token_returns_401():
    async with AsyncClient(app=app, base_url="http://test") as client:
        res = await client.get("/invoices/some-id")
    assert res.status_code == 401
```

## E2E Test (Playwright — Next.js only)

> Real pattern. The helper is **`signInAs(page, { email })`**, not `loginAs`, and it takes the user
> object a factory returned — not a bare email string. It leaves the page on `/dashboard` (proof the
> session survived `proxy.ts`'s `auth.protect()`), so navigate onward from there. Always clean up
> the Clerk user in a `finally` — `resetDb()` only truncates Postgres, it can't delete Clerk users,
> so a skipped teardown leaks a user onto the shared CI instance.

```ts
// e2e/invoice-creation.spec.ts
import { test, expect } from './helpers/db-test'
import { createTestUser, deleteTestUser } from '@/test/factories/user'
import { signInAs } from './helpers/auth'

test('user creates and sends an invoice', async ({ page }) => {
  const user = await createTestUser()
  try {
    await signInAs(page, user)
    await page.goto('/app/invoices/new')

    await page.getByLabel('Amount').fill('1500')
    await page.getByLabel('Currency').selectOption('CAD')
    await page.getByRole('button', { name: 'Create invoice' }).click()

    await expect(page.getByText('Invoice created')).toBeVisible()
  } finally {
    await deleteTestUser(user.userId, user.clerkId)
  }
})
```

## Universal Rules
- Test observable behavior, not implementation. Don't assert a function was called — assert what changed.
- One assertion per test where possible.
- Test names: `'returns 404 when user does not own the invoice'` — not `'test auth'`.
- Use factories for test data — never hardcoded UUIDs or emails.
- Tests must be idempotent: re-runnable in any order.
- Integration tests use a dedicated test DB — never dev DB.
- Mock only external services (email, Stripe, S3) — not your own modules. **In integration and E2E
  specs this is absolute**: they run against the real app over real HTTP against real Postgres, so
  there is nothing of ours left to mock, and a mock there would hollow out the exact thing the spec
  exists to prove. The one sanctioned exception lives in **vitest unit tests**: the narrow
  hand-rolled `@/lib/db` fake described in Repo Reality above. It is only ever evidence about
  *branch logic*, never about Postgres row-lock, advisory-lock, or transaction-isolation behaviour —
  anything in that second category belongs in a DB-backed spec.

## Reporting Coverage You Couldn't Achieve
The checklist below is the bar. When a box genuinely can't be ticked, the correct output is to
**name it explicitly in your summary** — which case, what it needs — not to quietly drop it or
substitute a weaker test that appears to cover it. A green suite that never exercised the path it
claims to cover actively misleads the next reviewer.

**"Blocked on infra" is now almost never the right answer.** Authenticated + DB, public + DB, and
public + no-DB cases are all writable against the harness (see Repo Reality) — the historical
blockers (no Postgres in CI, no Clerk session) are gone. Before reporting anything as blocked,
confirm the blocker is real *today* rather than repeating a constraint that used to hold. Cases
that are still genuinely awkward, and what to do instead:
- **Asserting an outbound email actually sent.** There's no inbox to check (`+clerk_test`
  addresses suppress delivery instance-side) and no interception seam in `lib/email.ts`. Assert the
  DB-visible gate that decides the send instead — see `sharing-concurrency.spec.ts`'s first-view
  test, which proves exactly-once via `firstViewedAt` rather than by counting emails.
- **Calling a `server-only` module directly from a spec.** `lib/report-shares.ts` et al. throw on
  import under Playwright's plain-Node runtime. Go through the real HTTP route, or (only for small
  pure helpers) reimplement with a comment pointing at the original — `test/factories/share.ts`
  does this for `mintShareToken`/`hashShareToken`.
- **In-process rate-limit buckets leaking across tests.** `lib/rate-limit.ts`'s Map lives for the
  whole `next start` process. Isolate per-test with a fresh test user (user-keyed limiters) or a
  synthetic `X-Forwarded-For` (IP-keyed ones), as `sharing-rate-limit.spec.ts` does.

## Audit Checklist
- [ ] Happy path covered
- [ ] Auth failure covered (401 unauthenticated, 403/404 unauthorized)
- [ ] Validation failure covered (422)
- [ ] Not-found covered (404)
- [ ] IDOR case: another user's resource returns 404
- [ ] Edge cases: empty arrays, zero values, boundary values
- [ ] Tests pass in isolation (no shared state leaking)
- [ ] Test DB isolated from dev DB
- [ ] Passes the `engineering-standards` Definition of Done
