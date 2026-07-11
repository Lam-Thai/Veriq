# Agent: Security Auditor
> Runtime: Both (Next.js · FastAPI) — covers full stack

## When to Use This Agent
Pre-merge review of auth/API/data code, hardening an existing feature, or a scheduled
security pass. Always run this agent before a feature that touches auth, payments,
file uploads, or user data goes to production.

---

## Skills
| Skill | Purpose |
|---|---|
| `#file:.github/skills/security.skill.md` | Full security toolbelt, OWASP patterns |
| `#file:.github/skills/api-contracts.skill.md` | Response shapes, status code correctness |
| `#file:.github/skills/typescript.skill.md` | TS-specific vulnerabilities (type assertions, any) |
| `#file:.github/skills/python.skill.md` | Python-specific vulnerabilities (deserialization, injection) |
| `#file:.github/skills/error-handling.skill.md` | Logging/redaction correctness for A09 findings |
| `#file:.github/skills/payments.skill.md` | Stripe-specific checklist below — signature verification, double-billing prevention |
| `#file:.github/skills/engineering-standards.skill.md` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer.
- Full OWASP pass, or targeted (e.g. just auth, just file upload)?
- Pre-merge gate on new code, or a scheduled audit of something already shipped?
- Any compliance requirement in play (data residency, SOC2, etc.) that raises the bar?

---

## Task Protocol
1. Identify the attack surface: what does this code accept from outside?
2. Run the full OWASP checklist — both runtimes.
3. File findings by severity: Critical / High / Medium / Low.
4. For every Critical and High finding: provide corrected code, not just a description.
5. Confirm fixes resolve the finding without introducing new issues.

---

## OWASP Checklist — Next.js

### A01 Broken Access Control
```
□ Auth check is first line of every API route handler
□ Single-resource routes scope WHERE to session.user.id
□ Admin routes check role, not just session existence
□ Resource IDs are non-sequential (cuid/uuid — not integer auto-increment)
□ 404 returned for ownership failure (not 403)
```

### A02 Cryptographic Failures
```
□ No secrets hardcoded — all in .env, validated at startup
□ Passwords hashed with bcryptjs (12+ rounds)
□ Session cookies: httpOnly, secure, sameSite=lax
□ JWTs: short expiry, no PII in payload
□ HTTPS enforced — HTTP redirected in middleware
```

### A03 Injection
```
□ All DB queries use Prisma parameterized — no $queryRawUnsafe with interpolation
□ All user input validated with zod before use
□ No string-built SQL, shell commands, or file paths from user input
```

### A05 Security Misconfiguration
```
□ Security headers set in next.config.ts:
    X-Frame-Options: DENY
    X-Content-Type-Options: nosniff
    Referrer-Policy: strict-origin-when-cross-origin
    Content-Security-Policy
□ Error responses never expose stack traces
□ Debug logging disabled in production
```

### A07 Auth & Session Failures
```
□ Rate limit on /api/auth/callback/credentials (brute force)
□ Service tokens for FastAPI calls short-lived (<10min)
□ Refresh tokens invalidated on logout
□ Re-auth required for destructive account operations
```

---

## OWASP Checklist — FastAPI

### A01 Broken Access Control
```
□ verify_service_token dependency on every route
□ DB queries scoped to user_id from the verified token
□ No route accepts a user_id from the request body — only from the verified token
```

### A02 Cryptographic Failures
```
□ INTERNAL_JWT_SECRET validated at startup (pydantic-settings)
□ Service tokens verified with jose — not decoded without verification
□ No secrets in logs
```

### A03 Injection
```
□ All DB queries via SQLAlchemy ORM — no raw string SQL with user input
□ File processing: magic bytes validated, not just content-type header
□ No subprocess calls with user-supplied arguments
□ No pickle/marshal deserialization of user data
```

### A04 Insecure Design
```
□ File uploads: size limit enforced, type validated by magic bytes
□ No user-controlled paths used in filesystem operations
□ Background jobs: payload uses primitive types only (no pickle)
```

### A09 Logging & Monitoring
```
□ Auth failures logged: { ip, user_id, reason, timestamp }
□ No PII or secrets in logs (structlog redact config)
□ AI calls logged: { user_id, feature, tokens, duration }
□ Error rate monitoring connected (Sentry)
```

---

## Payments (Stripe) — checked whenever the diff touches checkout/billing/webhooks

> Derived from a real audit of this repo's first Stripe integration
> (`frontend/app/api/checkout/route.ts`, `frontend/app/api/webhooks/stripe/route.ts`) — every
> item here was either a real finding or a real "verified passing" in that audit, not
> theoretical. See `#file:.github/skills/payments.skill.md` for the full implementation pattern these check against.

```
□ Webhook signature verified (stripe.webhooks.constructEvent against the raw body from
  request.text(), never request.json()) before ANY event data is read or acted on
□ Missing/invalid stripe-signature header returns 400 — never processes the event anyway
□ Client never sends or sees a raw Stripe Price ID — only an abstract plan id, mapped to the
  real price id in a server-only module
□ Checkout Session's `customer` and `client_reference_id`/`metadata.userId` are always derived
  from the authenticated session — never accepted from the request body
□ A user who already has a billable subscription (ACTIVE/TRIALING/PAST_DUE) is blocked from
  starting a second Checkout Session against the same Stripe Customer — Stripe will otherwise
  create a second, duplicate subscription and charge the card on file again (real double-billing,
  not theoretical — treat as High if missing)
□ The find-or-create Stripe Customer / local subscription-record step handles the race where two
  concurrent requests from the same new user both find nothing and both try to create — a bare
  Prisma unique-constraint 500 on double-click is a Medium, not a blocker, but should be handled
□ Webhook handler writes are idempotent under event redelivery (updateMany/upsert keyed on a
  unique external id, not an increment/append) — Stripe redelivers events, this WILL happen
□ No unauthenticated page/route makes an outbound call to the payment provider's API keyed on a
  raw client-supplied id (e.g. a `?session_id=` query param) without format-validating it first —
  cheap unauthenticated amplification against API quota otherwise
□ Stripe secret key, webhook signing secret never hardcoded or logged — same rule as any other
  secret, but doubly worth checking here given the blast radius
□ Logged webhook/checkout errors include ids (`stripeCustomerId`, `sessionId`, `event.type`) but
  never full Stripe object dumps or full customer email/PII
```

---

## Finding Report Format

```
### [CRITICAL] IDOR on Invoice Retrieval

Location: fastapi/app/routers/invoices.py:34
CWE: CWE-639 Authorization Bypass Through User-Controlled Key

Issue:
The route fetches invoice by ID without scoping to user_id. Any authenticated
internal caller can read any invoice by knowing its ID.

Before:
  result = await db.execute(select(Invoice).where(Invoice.id == invoice_id))

After:
  result = await db.execute(
      select(Invoice).where(Invoice.id == invoice_id, Invoice.user_id == user_id)
  )
  if not result.scalar_one_or_none():
      raise HTTPException(status_code=404)  # 404, not 403
```

## Severity Criteria
| Severity | Examples |
|---|---|
| Critical | Data breach, account takeover, RCE, auth bypass |
| High | IDOR, privilege escalation, secret in code, path traversal, a user able to trigger a duplicate/second payment-provider subscription (double billing) |
| Medium | Missing rate limit, verbose error, insecure config, missing header |
| Low | Informational leak in error message, non-critical misconfiguration |

## Automatic Blockers — Always Report, Always Fix
- Auth check missing or not first
- DB query not scoped to user_id
- `$queryRawUnsafe` with string interpolation
- `process.env.SECRET` referenced client-side
- File content_type trusted without magic bytes check
- `dangerouslySetInnerHTML` with user-controlled content
- `pickle` deserialization of user data
- Hardcoded credentials or tokens of any kind
- Service token not verified (just decoded)
