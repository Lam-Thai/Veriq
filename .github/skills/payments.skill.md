# Skill: Payments (Stripe)
> Runtime: Next.js only. Stripe is the only payment provider integrated in this repo.

This skill documents the real, working pattern from this repo's first Stripe integration
(`frontend/app/api/checkout/route.ts`, `frontend/app/api/webhooks/stripe/route.ts`,
`frontend/lib/stripe.ts`, `frontend/lib/stripe-price-map.ts`) — not a generic Stripe tutorial.
Read those files for the ground truth; this skill is the "why," they're the "what."

---

## Client Singleton
```ts
// lib/stripe.ts
import Stripe from 'stripe'
import { env } from '@/lib/env'

// No globalThis caching needed (unlike lib/db.ts's Prisma singleton) — the Stripe client
// holds no connection pool or HMR-sensitive state, a plain module-level singleton is fine.
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, { typescript: true })
```
Check whether the installed `stripe` package's types require an explicit `apiVersion` literal
(varies by major version) — pin it with a comment if so, don't guess a version string.

---

## Never Let the Client Choose a Price

The single most important rule in this skill. A client must never send, and a server must never
trust, a raw Stripe Price ID (`price_...`) — only an abstract, closed-enum plan id.

```ts
// lib/stripe-price-map.ts — server-only, never imported from a "use client" file
import 'server-only'
import { env } from '@/lib/env'

export const PAID_PLAN_IDS = ['pro', 'enterprise'] as const
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number]

export const STRIPE_PRICE_BY_PLAN: Record<PaidPlanId, string> = {
  pro: env.STRIPE_PRICE_ID_PRO,
  enterprise: env.STRIPE_PRICE_ID_ENTERPRISE,
}
```
```ts
// The API route validates against the closed enum, never accepts a price id directly
const BodySchema = z.object({ planId: z.enum(PAID_PLAN_IDS) })
```
A separate `lib/plans.ts` (no `server-only`, no env import) holds pure marketing/display data
(name, price label, feature list) safe to import from client components — keep display data and
the real price-ID resolution in two different files so a client bundle can never accidentally
pull in a secret-adjacent module.

---

## Creating a Checkout Session

```ts
// app/api/checkout/route.ts — see the real file for the full version incl. race handling
const clerkUser = await currentUser()
if (!clerkUser) return ApiError.unauthorized()

const { planId } = BodySchema.parse(await request.json()) // after safeParse check

// Find-or-create the Stripe Customer <-> local user link — reuse it on every call so a
// user never accumulates more than one Stripe Customer.
let stripeCustomerId = existingSubscription?.stripeCustomerId
if (!stripeCustomerId) {
  const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } })
  // ... persist { userId, stripeCustomerId: customer.id, status: "INCOMPLETE" } — see
  // "Race Condition" below before copying this verbatim.
}

const session = await stripe.checkout.sessions.create({
  mode: 'subscription',
  customer: stripeCustomerId,
  line_items: [{ price: STRIPE_PRICE_BY_PLAN[planId], quantity: 1 }],
  success_url: `${request.nextUrl.origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${request.nextUrl.origin}/pricing/cancel`,
  client_reference_id: user.id,
  metadata: { userId: user.id, planId },
})
if (!session.url) return ApiError.internal() // session.url is nullable per Stripe's types
return NextResponse.json({ data: { url: session.url } })
```
Client-side: `window.location.href = data.url` — a full-page redirect to Stripe-hosted Checkout,
not an embedded Stripe.js/Elements flow. No `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` usage is needed
for this shape; that var still gets documented/validated in `lib/env.ts` for when an embedded
flow is eventually added, but nothing consumes it yet — don't treat its presence as proof an
Elements integration exists.

### Block Duplicate Subscriptions — Real Finding, Not Theoretical
A signed-in user with an already-billable subscription (`ACTIVE`/`TRIALING`/`PAST_DUE`) must be
blocked from starting a second Checkout Session against the same Stripe Customer, or Stripe will
create a second, real subscription and charge the card on file again:
```ts
const STILL_BILLABLE: SubscriptionStatus[] = ['ACTIVE', 'TRIALING', 'PAST_DUE']
if (existingSubscription && STILL_BILLABLE.includes(existingSubscription.status)) {
  return ApiError.conflict('ALREADY_SUBSCRIBED', 'You already have an active subscription.')
}
```
This was a real **High**-severity finding in this repo's first audit — always check for it.

### Race Condition on First-Time Customer Creation
`findUnique` then `create` (not an atomic upsert) means two concurrent requests from the same
brand-new user can both find nothing and both attempt to create the local subscription row,
which is unique on `userId` — the loser throws a Prisma `P2002`. Handle it:
```ts
try {
  await db.subscription.create({ data: { userId, stripeCustomerId: customer.id, status: 'INCOMPLETE' } })
} catch (err) {
  const isUniqueViolation = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  if (!isUniqueViolation) throw err
  // Lost the race — reuse the winner's row, clean up the orphaned Stripe Customer.
  const winner = await db.subscription.findUniqueOrThrow({ where: { userId }, select: { stripeCustomerId: true } })
  stripeCustomerId = winner.stripeCustomerId
  await stripe.customers.del(customer.id).catch(() => {})
}
```

### Rate Limit `/api/checkout` — Real Finding, Now Fixed
The Checkout route makes 1-2 real outbound Stripe API calls per request (`customers.create`,
`checkout.sessions.create`); with no rate limit, one user could hammer it — piling up abandoned
Checkout Sessions and orphaned Customers, and burning Stripe API quota — for free, since the
still-billable guard above only blocks a *repeat* purchase, not rapid-fire attempts before any
subscription exists yet. Rate limit it the same way `ai/income-insights` and `report` already do:
```ts
const { success, resetAt } = checkRateLimit(`checkout:${clerkUser.id}`, 5, 60_000)
if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000))
```
Generous enough for a legitimate double-click retry, tight enough to bound cost/quota exposure.

### A Third, Distinct Race: Two Live Checkout Sessions Before the First Webhook Lands
The still-billable guard (above) only blocks a *second* subscribe attempt once the local
`Subscription.status` has already flipped to `ACTIVE`/`TRIALING`/`PAST_DUE` — which only happens
once the webhook for the *first* payment lands. For a brand-new user (`status: "INCOMPLETE"`),
two concurrent requests (two tabs, or a slow-network retry racing a resubmit) both pass that
check, both reuse the same `stripeCustomerId`, and both get a **valid, independent** Stripe
Checkout Session back. If the user completes payment on both before the first webhook arrives,
Stripe creates two real subscriptions against the same customer — a genuine double charge this
repo's rate-limit fix (above) narrows the window on but does not fully close. This is distinct
from the DB-row race documented above (that one is about the local table; this one is about two
live, independently-valid Stripe Checkout Sessions existing at once). Two possible remediations,
neither applied yet because both change checkout UX in a way that's a product decision, not a
pure bug fix:
1. `stripe.checkout.sessions.expire()` any prior open session for the customer before creating a
   new one — but this would silently invalidate a tab the user still has open with a live Stripe
   payment page loaded.
2. A short per-user lock (not just a rate limit) on `/api/checkout` for the duration of an
   in-flight request.
Decide with product before implementing either — don't silently pick one.

---

## Webhooks

```ts
// app/api/webhooks/stripe/route.ts — public, NOT behind Clerk auth (Stripe is the caller)
export async function POST(request: NextRequest) {
  const rawBody = await request.text()          // raw bytes, never request.json() first
  const signature = request.headers.get('stripe-signature')
  if (!signature) return /* 400 */

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)
  } catch {
    return /* 400 — reject BEFORE any event.data is read, no exceptions */
  }

  // ... switch on event.type, sync the local Subscription row, return 200
}
```
- **Never** call `request.json()` before (or instead of) `request.text()` in a webhook route —
  it changes the byte sequence Stripe signed and breaks verification.
- Handle at minimum `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`. Unknown event types: no-op, still return 200.
- Sync by `updateMany`/`upsert` keyed on `stripeCustomerId` (a unique column on the local
  subscription table) — **not** by trying to create a row from webhook data alone. The local
  row should already exist (created by `/api/checkout` when the Stripe Customer was made); if
  `updateMany`'s `count` comes back `0`, log it loudly as a data-integrity anomaly and move on —
  there's no `userId` in a webhook payload to synthesize a new row from, and retrying won't make
  one appear.
- Map Stripe's status enum onto your own smaller one explicitly, with a comment on every lossy
  mapping (e.g. Stripe's `paused` may have no equivalent in your schema — pick the closest bucket
  and say why in a comment, don't drop it silently).
- **Signature-failure vs. processing-failure status codes matter**: 400 only for a missing/invalid
  signature. If processing throws *after* the signature already verified, return 500 so the
  provider's retry mechanism kicks in — don't reuse 400 for that case.
- **Redelivery is safe** if every field written is a direct overwrite (not an increment/append) —
  applying the same event twice should be a no-op. **Out-of-order delivery** between *different*
  events is a separate, real gap most integrations (including this one) accept rather than solve;
  don't claim it's handled unless you've actually added ordering/timestamp checks.
- Check the installed `stripe` SDK's actual type definitions before writing field-access code —
  Stripe's API shape changes across versions (e.g. `current_period_end` has moved from the
  top-level `Subscription` object to `SubscriptionItem` in some API versions). Don't assume a
  field's location from training data or an older tutorial; grep the installed package's types.

---

## Unauthenticated Pages That Touch the Payment Provider

A public success/confirmation page reading `?session_id=` from the URL is a real amplification
vector if it calls out to Stripe on every hit without validating the id's shape first:
```ts
const CHECKOUT_SESSION_ID_PATTERN = /^cs_(test|live)_[A-Za-z0-9]+$/
if (!CHECKOUT_SESSION_ID_PATTERN.test(sessionId)) return null // skip the Stripe call entirely
```
Format-validate before the outbound call; treat any lookup failure as best-effort (fall back to
a generic message, never let a failed lookup break the page).

---

## Env Vars
```ts
STRIPE_SECRET_KEY: z.string().startsWith('sk_')           // server-only secret
STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_')     // verifies stripe-signature header
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_')  // reserved for future client SDK use
STRIPE_PRICE_ID_<PLAN>: z.string().startsWith('price_')    // one per paid plan, never client-visible
```
Test-mode keys (`sk_test_`/`pk_test_`) only outside a real production deploy. Get them from the
[Stripe Dashboard API keys page](https://dashboard.stripe.com/test/apikeys); get a local webhook
secret by running `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (Stripe CLI) —
never manually invent or hardcode a `whsec_` value.

---

## Rules
- Client sends an abstract plan id only, never a raw price id — server resolves it.
- Webhook routes: raw body, verify-before-read, 400 only for signature failure.
- Block a second Checkout Session for a user with a still-billable subscription.
- Handle the create-race on first-time Stripe Customer creation — don't ship the naive
  `findUnique` → `create` with no conflict handling.
- Rate limit `/api/checkout` per `userId` via `lib/rate-limit.ts` — every call makes real outbound
  Stripe requests (see "Rate Limit `/api/checkout`" above).
- Sync webhook data by update, not by upsert-that-can-create — a webhook shouldn't be able to
  synthesize a local record with no `userId`.
- Format-validate any client-supplied id before using it in a call to the payment provider from
  an unauthenticated route.
- No real/live keys ever hardcoded or committed — same as any other secret.

## Known Gap: No Test Coverage on the Guards Above
As of this writing, `e2e/pricing.spec.ts` only covers the pricing page's UI (headings, prices,
button presence) and explicitly skips clicking Subscribe, since that would hit the real
`/api/checkout`. There is no unit/integration test for the still-billable guard, the
create-race handler, or webhook signature verification — exactly the guards this skill documents
as real, previously-shipped findings. Nothing currently catches a regression in any of them. When
next touching this area, route test-writing through the `testing` agent rather than treating "the
skill documents it" as equivalent to "it's covered."
