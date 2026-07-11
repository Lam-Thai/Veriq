import type { Metadata } from "next";
import { Nav } from "@/components/landing/nav";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";
import { CheckBadgeIcon } from "@/components/ui/icons";
import { stripe } from "@/lib/stripe";
import type { PlanId } from "@/lib/plans";

export const metadata: Metadata = {
  title: "You're subscribed — Veriq",
  description: "Your Veriq subscription is confirmed.",
};

type PricingSuccessPageProps = {
  searchParams: Promise<{ session_id?: string }>;
};

const PLAN_NAME_BY_ID: Record<PlanId, string> = {
  free: "Free",
  pro: "Pro",
  enterprise: "Enterprise",
};

/**
 * Best-effort confirmation screen after a successful Stripe Checkout redirect. The subscription
 * itself is already recorded via the Stripe webhook — this page only reads the session back
 * (read-only, no mutation) to personalize the message with the plan name. Any lookup failure or
 * a missing/invalid session_id falls back to a generic success message rather than erroring.
 */
export default async function PricingSuccessPage({ searchParams }: PricingSuccessPageProps) {
  const { session_id: sessionId } = await searchParams;
  const planName = sessionId ? await getPlanName(sessionId) : null;

  return (
    <>
      <Nav />
      <main className="flex min-h-screen items-center justify-center bg-canvas-parchment px-6 py-16">
        <Card className="w-full max-w-sm text-center">
          <CheckBadgeIcon className="mx-auto h-10 w-10 text-verified" />
          <h1 className="mt-4 text-(length:--type-tagline-size)/(--type-tagline-lh) tracking-(--type-tagline-ls) font-semibold text-ink">
            {planName ? `You're subscribed to ${planName}` : "You're subscribed"}
          </h1>
          <p className="mt-3 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls) text-ink-muted-80">
            Your payment was successful and your plan is now active.
          </p>
          <PillButton as="a" href="/dashboard" className="mt-6 w-full">
            Go to dashboard
          </PillButton>
        </Card>
      </main>
    </>
  );
}

// Stripe Checkout Session IDs always match this shape. Validating before calling out to Stripe
// stops an unauthenticated visitor from using this public page as a free-form trigger for
// arbitrary outbound Stripe API calls via `?session_id=<anything>`.
const CHECKOUT_SESSION_ID_PATTERN = /^cs_(test|live)_[A-Za-z0-9]+$/;

async function getPlanName(sessionId: string): Promise<string | null> {
  if (!CHECKOUT_SESSION_ID_PATTERN.test(sessionId)) return null;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const planId = session.metadata?.planId;
    if (planId === "pro" || planId === "enterprise") return PLAN_NAME_BY_ID[planId];
    return null;
  } catch (err) {
    console.error("[pricing/success] failed to retrieve checkout session", err);
    return null;
  }
}
