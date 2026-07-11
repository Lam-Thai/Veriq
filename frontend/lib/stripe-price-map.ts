import "server-only";
import { env } from "@/lib/env";

/**
 * Server-only plan -> Stripe Price ID map. The client only ever sends/sees the abstract plan id
 * ("pro" | "enterprise"); the real Stripe Price ID is resolved here so a caller can never smuggle
 * an arbitrary price into a Checkout Session. This module reads `env`, which parses
 * `process.env` (including server secrets) at import time — the `server-only` import makes any
 * accidental import from a "use client" file a build error instead of a silent leak.
 */
export const PAID_PLAN_IDS = ["pro", "enterprise"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export const STRIPE_PRICE_BY_PLAN: Record<PaidPlanId, string> = {
  pro: env.STRIPE_PRICE_ID_PRO,
  enterprise: env.STRIPE_PRICE_ID_ENTERPRISE,
};
