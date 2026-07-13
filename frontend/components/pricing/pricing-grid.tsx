"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Card } from "@/components/ui/card";
import { PillButton } from "@/components/ui/pill-button";
import { CheckIcon } from "@/components/ui/icons";
import { PLANS, type Plan, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/cn";

type CheckoutState = {
  loading: boolean;
  error: string | null;
};

type CheckoutStateMap = Record<PlanId, CheckoutState>;

type CheckoutSuccessBody = { data: { url: string } };
type CheckoutErrorBody = { error: { code: string; message: string } };

// Discriminated result of the /api/checkout call — computed entirely inside try/catch, then
// branched on afterward, mirroring app/connect/[slug]/consent/consent-actions.tsx's shape.
type CheckoutResult =
  | { outcome: "redirect"; url: string }
  | { outcome: "unauthenticated" }
  | { outcome: "failed"; message: string };

const IDLE_CHECKOUT_STATE: CheckoutState = { loading: false, error: null };
const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";
const NETWORK_ERROR_MESSAGE = "Network error. Check your connection and try again.";
const SIGN_IN_REDIRECT_URL = "/sign-in?redirect_url=/pricing";

/**
 * Starts a Stripe Checkout session for `planId` and redirects the browser on success. Defined at
 * module scope (outside PricingGrid) rather than as a closure over the `plan.id` produced by the
 * PLANS.map() below — the React Compiler's mutation analysis mis-flags a `window.location.href`
 * assignment reached through a map-loop-variable closure as an unsafe external mutation, even
 * though it's the same "redirect after a resolved fetch" shape as consent-actions.tsx. Taking
 * `setCheckoutState` as a parameter instead of closing over it sidesteps that false positive.
 */
async function startCheckout(planId: PlanId, setCheckoutState: Dispatch<SetStateAction<CheckoutStateMap>>) {
  setCheckoutState((prev) => ({ ...prev, [planId]: { loading: true, error: null } }));

  let result: CheckoutResult;
  try {
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });

    if (response.status === 401) {
      result = { outcome: "unauthenticated" };
    } else if (!response.ok) {
      const body = (await response.json().catch(() => null)) as CheckoutErrorBody | null;
      result = { outcome: "failed", message: body?.error.message ?? GENERIC_ERROR_MESSAGE };
    } else {
      const body = (await response.json()) as CheckoutSuccessBody;
      result = { outcome: "redirect", url: body.data.url };
    }
  } catch {
    result = { outcome: "failed", message: NETWORK_ERROR_MESSAGE };
  }

  if (result.outcome === "redirect") {
    window.location.href = result.url;
    return;
  }

  if (result.outcome === "unauthenticated") {
    window.location.href = SIGN_IN_REDIRECT_URL;
    return;
  }

  setCheckoutState((prev) => ({ ...prev, [planId]: { loading: false, error: result.message } }));
}

/**
 * Renders the three pricing tiers and owns the Stripe Checkout kick-off for the two paid plans.
 * Kept as a single client component — with only two interactive CTAs in a 3-item grid, a
 * per-card loading/error state map is simpler than splitting into a client component per card.
 */
export function PricingGrid() {
  const [checkoutState, setCheckoutState] = useState<CheckoutStateMap>({
    free: IDLE_CHECKOUT_STATE,
    pro: IDLE_CHECKOUT_STATE,
    enterprise: IDLE_CHECKOUT_STATE,
  });

  return (
    <div className="mx-auto mt-12 grid max-w-grid grid-cols-1 gap-6 md:grid-cols-3">
      {PLANS.map((plan) => (
        <PricingCard
          key={plan.id}
          plan={plan}
          checkoutState={checkoutState[plan.id]}
          onSubscribe={() => startCheckout(plan.id, setCheckoutState)}
        />
      ))}
    </div>
  );
}

type PricingCardProps = {
  plan: Plan;
  checkoutState: CheckoutState;
  onSubscribe: () => void;
};

// Hierarchy: "Most popular" badge (Pro only) → plan name → price → description → feature list →
// CTA → inline error. Pro is the only dark-toned/primary-CTA card — the visual "recommended" tier.
function PricingCard({ plan, checkoutState, onSubscribe }: PricingCardProps) {
  const isHighlighted = plan.highlighted ?? false;

  return (
    <Card tone={isHighlighted ? "dark" : "light"} className="flex h-full flex-col">
      {isHighlighted && (
        <span className="mb-4 inline-flex w-fit items-center rounded-pill bg-primary px-3 py-1 text-(length:--type-fine-print-size) font-semibold tracking-(--type-fine-print-ls) text-on-primary uppercase">
          Most popular
        </span>
      )}

      <h3
        className={cn(
          "text-(length:--type-tagline-size)/(--type-tagline-lh) tracking-(--type-tagline-ls) font-semibold",
          isHighlighted ? "text-white" : "text-ink",
        )}
      >
        {plan.name}
      </h3>

      <div className="mt-3 flex items-baseline gap-1">
        <span
          className={cn(
            "text-(length:--type-lead-size)/(--type-lead-lh) tracking-(--type-lead-ls) font-semibold",
            isHighlighted ? "text-white" : "text-ink",
          )}
        >
          {plan.priceLabel}
        </span>
        {plan.priceSuffix && (
          <span
            className={cn(
              "text-(length:--type-caption-size) tracking-(--type-caption-ls)",
              isHighlighted ? "text-body-muted" : "text-ink-muted-48",
            )}
          >
            {plan.priceSuffix}
          </span>
        )}
      </div>

      <p
        className={cn(
          "mt-3 text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls)",
          isHighlighted ? "text-body-muted" : "text-ink-muted-80",
        )}
      >
        {plan.description}
      </p>

      <ul className="mt-6 flex flex-col gap-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <CheckIcon
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                isHighlighted ? "text-primary-on-dark" : "text-primary",
              )}
            />
            <span
              className={cn(
                "text-(length:--type-body-size)/(--type-body-lh) tracking-(--type-body-ls)",
                isHighlighted ? "text-body-muted" : "text-ink-muted-80",
              )}
            >
              {feature}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex flex-1 flex-col justify-end gap-2">
        {plan.id === "free" ? (
          <PillButton as="a" href="/sign-up" variant="secondary-light" className="w-full">
            {plan.cta}
          </PillButton>
        ) : (
          <PillButton
            type="button"
            variant={isHighlighted ? "primary" : "secondary-light"}
            className="w-full"
            disabled={checkoutState.loading}
            onClick={onSubscribe}
          >
            {checkoutState.loading ? "Redirecting…" : plan.cta}
          </PillButton>
        )}

        {checkoutState.error && (
          <p role="alert" className="text-(length:--type-caption-size) text-danger">
            {checkoutState.error}
          </p>
        )}
      </div>
    </Card>
  );
}
