# Agent: Test Writer
> Runtime: Both (vitest for Next.js · pytest for FastAPI)

## When to Use This Agent
Writing unit tests, integration tests, or E2E tests for either runtime.

---

## Skills
| Skill | Purpose |
|---|---|
| `#file:.github/skills/typescript.skill.md` | TypeScript test typing, zod schema testing |
| `#file:.github/skills/python.skill.md` | pytest patterns, fixtures, async testing |
| `#file:.github/skills/api-contracts.skill.md` | Response envelope shape assertions (`data`/`error`) |
| `#file:.github/skills/error-handling.skill.md` | Testing error paths, failure modes |
| `#file:.github/skills/engineering-standards.skill.md` | Security/scalability/readability bar — applies to all output |

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

## Audit Checklist
- [ ] Happy path covered
- [ ] Auth failure covered (401 unauthenticated, 403/404 unauthorized)
- [ ] Validation failure covered (422)
- [ ] Not-found covered (404)
- [ ] IDOR case: another user's resource returns 404
- [ ] Edge cases: empty arrays, zero values, boundary values
- [ ] Tests pass in isolation (no shared state leaking)
- [ ] Test DB isolated from dev DB
- [ ] Passes `engineering-standards.skill.md` Definition of Done
