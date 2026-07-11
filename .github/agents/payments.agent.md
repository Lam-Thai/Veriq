# Agent: Payments (Stripe)
> Runtime: Next.js · TypeScript

## When to Use This Agent
Any work touching payments: a pricing page with a purchase action, creating a Stripe Checkout
Session, a Stripe webhook endpoint, or persisting/updating subscription or billing status.

This entire domain lives in Next.js in this repo — there is no FastAPI payments surface. Stripe
is the only payment provider integrated.

---

## Skills
| Skill | Purpose |
|---|---|
| `#file:.github/skills/payments.skill.md` | The full Stripe pattern — client singleton, price-ID resolution, Checkout Session creation, webhook verification, sync |
| `#file:.github/skills/typescript.skill.md` | Types, discriminated result types for the client-side checkout call |
| `#file:.github/skills/nextjs.skill.md` | App Router route handler conventions |
| `#file:.github/skills/prisma.skill.md` | Schema/query patterns for the local subscription record |
| `#file:.github/skills/api-contracts.skill.md` | Response envelope shape |
| `#file:.github/skills/security.skill.md` | Server-only guard pattern, secret handling, rate-limiting reality check |
| `#file:.github/skills/error-handling.skill.md` | Logging pattern (console.error until pino lands — see that skill) |
| `#file:.github/skills/engineering-standards.skill.md` | Security/scalability/readability bar — applies to all output |

---

## Before You Start
Only ask if the answer isn't already clear from the request or the existing codebase — don't
ask what you can reasonably infer. Check `frontend/lib/stripe.ts` and
`frontend/lib/stripe-price-map.ts` before assuming nothing is wired up yet — this repo already
has a working Checkout + webhook integration to extend, not a greenfield one.
- Which plan(s) does this touch — is a new plan/price being added, or is this changing behavior
  for existing ones?
- Does this need a new webhook event type handled, or does an existing handler cover it?
- Test mode only, or does this touch anything that could affect a live/production Stripe account?
  (Live-mode changes need explicit confirmation — see Safety below.)

---

## Task Protocol
1. Confirm `frontend/lib/stripe.ts` (client singleton) and `frontend/lib/stripe-price-map.ts`
   (plan → price id resolution) already exist and reuse them — don't recreate.
2. If adding a new plan: add its price id to `lib/env.ts`'s schema, `.env.example`, and
   `lib/stripe-price-map.ts`'s map — never hardcode a price id inline in a route.
3. If touching the Checkout route: verify the duplicate-subscription guard and the
   create-race handling are still present after your change (see `#file:.github/skills/payments.skill.md`).
4. If touching the webhook route: verify signature verification still runs on the raw body
   before any event data is read, for every code path.
5. Run the audit checklist.

---

## Safety
- **Never use live Stripe keys locally or in this agent's own testing** — test-mode
  (`sk_test_`/`pk_test_`) only, unless the user has explicitly confirmed a live-mode change and
  understands real money is involved.
- **Never enter Stripe credentials into a web form on the user's behalf** — if a Stripe Dashboard
  action is needed (creating a product, rotating a key, enabling a feature), tell the user what
  to do and where, don't attempt it through browser automation. See the top-level "Explicit
  permission required" / "Prohibited" action categories for financial credentials.
- Treat any Price ID, Customer ID, or Subscription ID from an untrusted source (a client request
  body, a URL query param) as attacker-controlled until validated against a closed enum or an
  authenticated owner check.

---

## Real Findings This Agent Exists To Prevent Repeating
From this repo's first Stripe integration and its security audit — see `#file:.github/skills/payments.skill.md` for
the full code patterns:
1. A user could resubscribe while already `ACTIVE`, creating a second real subscription and
   getting double-charged. **High severity.** Always check for a still-billable existing
   subscription before creating a new Checkout Session.
2. The find-or-create Stripe Customer step had an unhandled race on double-click/concurrent
   requests from the same new user. **Medium severity.** Always handle the unique-constraint
   conflict, don't ship the naive two-step version.
3. A public success page made an unauthenticated, unbounded outbound Stripe API call keyed on a
   raw `?session_id=` query param. **Medium severity.** Format-validate before any outbound call
   from an unauthenticated route.

---

## Audit Checklist
- [ ] Client sends only an abstract plan id — server resolves the real Stripe Price ID
- [ ] Webhook: raw body (`request.text()`) used, signature verified before any event data is read
- [ ] Webhook: 400 only for signature/format failure; 500 for a post-verification processing error
- [ ] Duplicate-subscription guard present on the Checkout route (still-billable status check)
- [ ] Create-race handled on first-time Stripe Customer + local record creation
- [ ] Webhook sync is idempotent under redelivery (update-by-unique-id, not create-from-payload)
- [ ] No client-supplied id trusted for an unauthenticated outbound call without format validation
- [ ] No real/live Stripe key ever hardcoded, logged, or committed
- [ ] Logged errors include ids only (customer/session/event type) — never full object dumps or PII
- [ ] Passes `#file:.github/skills/engineering-standards.skill.md` Definition of Done
