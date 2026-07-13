/**
 * Marketing/display data for the pricing page. Deliberately decoupled from
 * `lib/stripe-price-map.ts`: this file has no env import and no `server-only` marker, so it's
 * safe to import from both the server-rendered pricing page and the client-side pricing grid.
 * The real Stripe Price IDs behind each paid plan live server-side only, in stripe-price-map.ts.
 */

export type PlanId = "free" | "pro" | "enterprise";

export type Plan = {
  id: PlanId;
  name: string;
  priceLabel: string;
  priceSuffix: string;
  description: string;
  features: string[];
  cta: string;
  /** True for the single visually "recommended" tier (Pro). */
  highlighted?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    priceLabel: "$0",
    priceSuffix: "",
    description: "Try Veriq with a single verified income report.",
    features: [
      "1 verified income report",
      "Connect up to 2 platforms",
      "Lender-ready PDF export",
      "Report valid for 7 days",
    ],
    cta: "Get started",
  },
  {
    id: "pro",
    name: "Pro",
    priceLabel: "$29",
    priceSuffix: "/month",
    description: "For gig workers who need proof of income on demand.",
    features: [
      "Unlimited verified reports",
      "Connect unlimited platforms",
      "Shareable verified report links",
      "Priority email support",
      "Report valid for 90 days",
    ],
    cta: "Subscribe",
    highlighted: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceLabel: "$99",
    priceSuffix: "/month",
    description: "For lending teams verifying income at scale.",
    features: [
      "Everything in Pro",
      "Bulk report generation",
      "Dedicated onboarding & support",
      "API access for underwriting workflows",
      "Custom report branding",
    ],
    cta: "Subscribe",
  },
];
