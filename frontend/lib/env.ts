import { z } from "zod";

const EnvSchema = z.object({
  // Pooled (PgBouncer, transaction mode) connection — used by the app's runtime queries.
  DATABASE_URL: z.url(),
  // Direct (non-pooled) connection — required by Prisma's migration engine.
  DIRECT_URL: z.url(),
  // Server-side secret key (test mode: sk_test_...), never exposed to the client.
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  // Signing secret used to verify the stripe-signature header on incoming webhook events.
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  // Publishable key, safe to expose client-side; not currently consumed by app code (the
  // Checkout flow redirects server-side, no Stripe.js on the client yet) but documented/
  // validated for when client-side Stripe.js/Elements gets added.
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  // Stripe Price ID for the Pro plan (test mode).
  STRIPE_PRICE_ID_PRO: z.string().startsWith("price_"),
  // Stripe Price ID for the Enterprise plan (test mode).
  STRIPE_PRICE_ID_ENTERPRISE: z.string().startsWith("price_"),
});

export const env = EnvSchema.parse(process.env);
