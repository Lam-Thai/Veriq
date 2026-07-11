import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe";
import { SubscriptionStatus } from "@/lib/generated/prisma/enums";

/**
 * Server-to-server endpoint Stripe calls directly — intentionally NOT behind Clerk auth (there
 * is no user session on this request; Stripe is the caller). Trust is established purely via the
 * `stripe-signature` header verified against STRIPE_WEBHOOK_SECRET below, not via proxy.ts, which
 * only gates /dashboard(.*) and never touches this route.
 *
 * Maps a Stripe subscription status onto our smaller SubscriptionStatus enum. Stripe's `paused`
 * status (a trial that ended with no payment method on file, so no invoices are being generated)
 * has no direct equivalent in our enum; we bucket it under UNPAID since, like UNPAID, the
 * subscription is not currently collecting payment and needs customer action to resume.
 */
function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  switch (status) {
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "trialing":
      return SubscriptionStatus.TRIALING;
    case "past_due":
      return SubscriptionStatus.PAST_DUE;
    case "canceled":
      return SubscriptionStatus.CANCELED;
    case "unpaid":
      return SubscriptionStatus.UNPAID;
    case "paused":
      // See doc comment above — closest bucket to "not collecting payment right now".
      return SubscriptionStatus.UNPAID;
    case "incomplete":
      return SubscriptionStatus.INCOMPLETE;
    case "incomplete_expired":
      // Terminal failure-to-start state; our enum has no distinct bucket for it, and treating it
      // as INCOMPLETE (rather than CANCELED) avoids implying the customer ever had an active sub.
      return SubscriptionStatus.INCOMPLETE;
    default:
      status satisfies never;
      return SubscriptionStatus.INCOMPLETE;
  }
}

/**
 * Updates the Subscription row matching `stripeCustomerId` (unique on our model) from a Stripe
 * Subscription object. Uses updateMany (not upsert): a webhook should only ever be updating a
 * row that our own /api/checkout route already created when it made the Stripe Customer. If no
 * row matches, we have no `userId` to synthesize one from a webhook payload alone — log loudly
 * and move on, since retrying won't make a row that will never exist appear.
 */
async function syncSubscriptionFromStripe(stripeCustomerId: string, sub: Stripe.Subscription, forceCanceled = false) {
  const status = forceCanceled ? SubscriptionStatus.CANCELED : mapStripeStatus(sub.status);
  // `current_period_end` moved off the top-level Subscription object onto each subscription item
  // in this API version — see node_modules/stripe/cjs/resources/SubscriptionItems.d.ts.
  const currentPeriodEndSeconds = sub.items.data[0]?.current_period_end;

  const result = await db.subscription.updateMany({
    where: { stripeCustomerId },
    data: {
      stripeSubscriptionId: sub.id,
      stripePriceId: sub.items.data[0]?.price.id ?? null,
      status,
      currentPeriodEnd: currentPeriodEndSeconds ? new Date(currentPeriodEndSeconds * 1000) : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  });

  if (result.count === 0) {
    console.error("[stripe webhook] no Subscription row found for stripeCustomerId", stripeCustomerId);
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: { code: "MISSING_SIGNATURE", message: "Missing stripe-signature header" } },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed", err);
    return NextResponse.json(
      { error: { code: "INVALID_SIGNATURE", message: "Signature verification failed" } },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // We never pass `expand` on session creation, so these come back as raw ID strings, not
        // expanded objects — narrow defensively rather than assuming.
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (customerId && subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await syncSubscriptionFromStripe(customerId, subscription);
        }
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
        await syncSubscriptionFromStripe(customerId, subscription);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
        // A deleted subscription is canonically CANCELED in our enum regardless of Stripe's own
        // `status` field at the time of deletion.
        await syncSubscriptionFromStripe(customerId, subscription, true);
        break;
      }
      default:
        // Unhandled event type — no-op, fall through to the 200 response below.
        break;
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    // Signature verification already succeeded by this point, so an error here is an unexpected
    // processing failure (DB down, etc.) rather than a malformed/forged request — return 500 so
    // Stripe's retry mechanism kicks in, instead of 400 (reserved for signature/format problems).
    console.error("[stripe webhook] unhandled error processing event", event.type, err);
    return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 });
  }
}
