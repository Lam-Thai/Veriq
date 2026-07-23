import "server-only";
import { db } from "@/lib/db";
import type { PlanId } from "@/lib/plans";
import { PAID_PLAN_IDS, STRIPE_PRICE_BY_PLAN, type PaidPlanId } from "@/lib/stripe-price-map";
import { SubscriptionStatus } from "@/lib/generated/prisma/enums";

// Inverse of STRIPE_PRICE_BY_PLAN — resolving a plan from a stored Stripe Price ID needs the
// reverse direction from the one checkout uses to resolve a Price ID from a plan.
const PLAN_BY_STRIPE_PRICE: Record<string, PaidPlanId> = Object.fromEntries(
  PAID_PLAN_IDS.map((planId) => [STRIPE_PRICE_BY_PLAN[planId], planId]),
);

// Same grace-period stance Stripe itself takes: a subscription retrying a failed payment
// (PAST_DUE) still counts as paid so a user isn't suddenly capped mid-retry. Only a subscription
// that has definitively stopped billing (CANCELED/UNPAID) or never completed (INCOMPLETE) drops
// the user to free-tier limits.
const ENTITLED_STATUSES: SubscriptionStatus[] = [
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.PAST_DUE,
];

/**
 * Resolves the plan tier to use for entitlement checks (platform connect cap, report generation
 * cap/validity window) — the real, server-side counterpart to lib/plans.ts's marketing copy. Takes
 * a Clerk id (not this app's internal User.id) so it can be called directly from anywhere
 * `currentUser()`/`auth()` is already available, same convention lib/dashboard-data.ts's
 * getUserConnections uses. A user with no Subscription row at all (never checked out), or one
 * whose status/price doesn't map to a known paid plan, is "free" — never treated as an error.
 */
export async function resolveUserPlan(clerkId: string): Promise<PlanId> {
  const subscription = await db.subscription.findFirst({
    where: { user: { clerkId } },
    select: { status: true, stripePriceId: true },
  });
  if (!subscription?.stripePriceId) return "free";
  if (!ENTITLED_STATUSES.includes(subscription.status)) return "free";
  return PLAN_BY_STRIPE_PRICE[subscription.stripePriceId] ?? "free";
}
