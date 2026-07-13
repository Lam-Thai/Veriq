import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { ApiError } from "@/lib/api-error";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { PAID_PLAN_IDS, STRIPE_PRICE_BY_PLAN } from "@/lib/stripe-price-map";
import { Prisma } from "@/lib/generated/prisma/client";
import { SubscriptionStatus } from "@/lib/generated/prisma/enums";

// A customer whose subscription is still billable must not start a second Checkout Session
// against the same Stripe Customer — Stripe would happily create a second, duplicate
// subscription and charge the card on file again.
const STILL_BILLABLE_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
];

const BodySchema = z.object({
  planId: z.enum(PAID_PLAN_IDS),
});

/**
 * Starts a Stripe Checkout session for the signed-in user to subscribe to a paid plan.
 * The client only ever sends an abstract `planId` ("pro" | "enterprise") — never a raw Stripe
 * Price ID — so a caller can't smuggle an arbitrary price into the session; the real price id is
 * resolved server-side from STRIPE_PRICE_BY_PLAN. The Stripe Customer <-> our User link is
 * created lazily here (on first checkout attempt) and reused on every subsequent call so a user
 * never ends up with more than one Stripe Customer.
 */
export async function POST(request: NextRequest) {
  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    const body: unknown = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return ApiError.unprocessable(parsed.error);
    const { planId } = parsed.data;

    const email = clerkUser.primaryEmailAddress?.emailAddress;
    if (!email) {
      console.error("[checkout] clerk user has no primary email", { clerkId: clerkUser.id });
      return ApiError.internal();
    }

    const user = await db.user.upsert({
      where: { clerkId: clerkUser.id },
      create: { clerkId: clerkUser.id, email },
      update: {},
      select: { id: true, email: true },
    });

    const existingSubscription = await db.subscription.findUnique({
      where: { userId: user.id },
      select: { stripeCustomerId: true, status: true },
    });

    if (existingSubscription && STILL_BILLABLE_STATUSES.includes(existingSubscription.status)) {
      return ApiError.conflict("ALREADY_SUBSCRIBED", "You already have an active subscription.");
    }

    let stripeCustomerId = existingSubscription?.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id, clerkId: clerkUser.id },
      });

      try {
        await db.subscription.create({
          data: { userId: user.id, stripeCustomerId: customer.id, status: "INCOMPLETE" },
        });
        stripeCustomerId = customer.id;
      } catch (err) {
        const isUniqueViolation = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
        if (!isUniqueViolation) throw err;

        // Lost a race with a concurrent request from the same new user (e.g. a double-click) —
        // it already created the Subscription row. Reuse its customer id and clean up the
        // orphaned Stripe Customer we just created instead of leaving it dangling.
        const winner = await db.subscription.findUniqueOrThrow({
          where: { userId: user.id },
          select: { stripeCustomerId: true },
        });
        stripeCustomerId = winner.stripeCustomerId;
        await stripe.customers.del(customer.id).catch(() => {});
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: STRIPE_PRICE_BY_PLAN[planId], quantity: 1 }],
      success_url: `${request.nextUrl.origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${request.nextUrl.origin}/pricing/cancel`,
      client_reference_id: user.id,
      metadata: { userId: user.id, planId },
    });

    if (!session.url) {
      console.error("[checkout] stripe returned a checkout session with no url", { sessionId: session.id });
      return ApiError.internal();
    }

    return NextResponse.json({ data: { url: session.url } });
  } catch (err) {
    console.error("[checkout] unhandled error", err);
    return ApiError.internal();
  }
}
