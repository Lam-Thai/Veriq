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
- **The integration-test harness does NOT exist yet.** `@/test/factories/*`, `@/test/helpers/client`,
  and a dedicated test DB are illustrative only — do not import them until they're built. The same
  goes for the Playwright login helper (`e2e/helpers/auth`): there is no Clerk test-session infra,
  so current `e2e/*.spec.ts` only cover the unauthenticated boundary (e.g. `/dashboard` redirects to
  sign-in). `.github/workflows/playwright.yml` has **no Postgres service container** — the
  placeholder `DATABASE_URL` there is scoped to the `npm ci` step alone (Prisma 7's config loader
  requires the var to be *present* for `prisma generate`, which never connects); the build and e2e
  steps receive no `DATABASE_URL` at all. So no spec can seed or read a real row in CI. Note that
  real Clerk secrets *are* wired into that workflow (there's even a preflight step verifying them) —
  what's missing is a way to establish a signed-in **session**, not Clerk configuration. Building
  any of that harness is real setup work to plan, not a given.
- **The only `@/lib/db` mock is a narrow hand-rolled fake — and that's the ceiling, not a
  starting point.** `lib/report-shares.test.ts` does `vi.mock("@/lib/db", () => ({ db: mockDb }))`
  with a small in-memory object mimicking `updateMany`'s zero-count semantics, to prove exactly one
  of two concurrent callers wins the first-claim race. That's a legitimate unit test of the
  *branch logic*, and it's the pattern to copy for a similarly narrow seam. It is emphatically
  **not** a test of the Postgres row lock — annotate any such fake so nobody later reads it as
  proof the DB guarantee holds.
- **Fidelity ceiling:** a hand-rolled fake can only ever prove your branching is right, never that
  Postgres does what you think (advisory locks, cross-connection row locks, real transaction
  isolation, cascade behaviour, constraint violations). Ownership checks, cap enforcement, and
  cursor gating that live inside a `db.$transaction` are therefore still effectively
  integration-only. Don't paper over that: cover the pure layer that *is* reachable (zod schemas,
  token/regex/hash helpers, calculators), and say plainly in your summary which cases remain
  uncovered and why — never downgrade an IDOR test into something that doesn't exercise IDOR.
  Building out a general Prisma-mocking framework is out of scope; a real test DB is the fix.
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
- Run e2e through `npm run test:e2e`, never a bare `npx playwright test` — `npx` may fetch a
  different Playwright version than the installed `@playwright/test` and fail with a confusing
  "did not expect test.describe() to be called here".

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

> Target pattern — the `@/test/*` factories/client and test DB it imports don't exist yet (see
> Repo Reality). Build that harness first.

```ts
// app/api/invoices/route.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestUser, createTestSession } from '@/test/factories/user'
import { testClient } from '@/test/helpers/client'
import { db } from '@/lib/db'

describe('POST /api/invoices', () => {
  beforeEach(async () => { await db.$executeRaw`TRUNCATE "Invoice" CASCADE` })

  it('creates a draft invoice for authenticated user', async () => {
    const { cookie } = await createTestSession(await createTestUser())
    const res = await testClient.post('/api/invoices', {
      headers: { Cookie: cookie },
      body: { total: 500, currency: 'CAD' },
    })
    expect(res.status).toBe(201)
    expect(res.data.status).toBe('DRAFT')
  })

  it('returns 401 for unauthenticated request', async () => {
    const res = await testClient.post('/api/invoices', { body: { total: 500 } })
    expect(res.status).toBe(401)
  })

  it('returns 422 for missing required fields', async () => {
    const { cookie } = await createTestSession(await createTestUser())
    const res = await testClient.post('/api/invoices', {
      headers: { Cookie: cookie },
      body: {},
    })
    expect(res.status).toBe(422)
  })
})
```

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

> Target pattern — `loginAs`/`e2e/helpers/auth` and Clerk test sessions don't exist yet (see Repo
> Reality). Today's specs only cover the unauthenticated boundary.

```ts
// e2e/invoice-creation.spec.ts
import { test, expect } from '@playwright/test'
import { loginAs } from './helpers/auth'

test('user creates and sends an invoice', async ({ page }) => {
  await loginAs(page, 'test@example.com')
  await page.goto('/app/invoices/new')

  await page.getByLabel('Amount').fill('1500')
  await page.getByLabel('Currency').selectOption('CAD')
  await page.getByRole('button', { name: 'Create invoice' }).click()

  await expect(page.getByText('Invoice created')).toBeVisible()
})
```

## Universal Rules
- Test observable behavior, not implementation. Don't assert a function was called — assert what changed.
- One assertion per test where possible.
- Test names: `'returns 404 when user does not own the invoice'` — not `'test auth'`.
- Use factories for test data — never hardcoded UUIDs or emails.
- Tests must be idempotent: re-runnable in any order.
- Integration tests use a dedicated test DB — never dev DB.
- Mock only external services (email, Stripe, S3) — not your own modules.

## Reporting Coverage You Couldn't Achieve
The checklist below is the bar. When a box genuinely can't be ticked with the harness that exists
(see Repo Reality), the correct output is to **name it explicitly in your summary** — which case,
what infra it needs — not to quietly drop it or substitute a weaker test that appears to cover it.
An honest "IDOR, cap-enforcement, and rate-limit cases need a test DB + Clerk test session, none of
which exist" is far more useful than a green suite that never exercised those paths, because the
green suite actively misleads the next reviewer.

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
