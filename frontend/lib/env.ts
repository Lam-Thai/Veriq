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
  // Server-side only — powers the AI income-narrative feature (lib/ai.ts). Never exposed via
  // NEXT_PUBLIC_ and never logged.
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),
});

// `next build`'s "Collecting page data" step imports every route module to statically analyze
// it (segment config, runtime, etc.) — it never invokes a GET/POST handler, but top-level module
// code still runs just by being imported, which includes this file's schema validation below and
// the `new Stripe(...)` / `new PrismaPg(...)` singletons in lib/stripe.ts / lib/db.ts that read
// `env.*` at module scope. That means every secret would otherwise be required just to run
// `next build`, even in a CI build step that never serves real traffic and never actually calls
// Stripe or the database. Next.js sets `process.env.NEXT_PHASE` to this exact value only for the
// `next build` CLI process itself (node_modules/next/dist/build/index.js) — `next start`/
// `next dev`/a real deployment are separate process launches where this isn't set, so relaxing
// validation here only affects the build step and never anything that actually serves a request.
const isProductionBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

// Build-time-only placeholders — every field still satisfies its own format constraint (a valid
// URL, an `sk_`-prefixed string, ...) so a module-scope client construction doesn't throw during
// static analysis. Real values always win when present; this only fills in what's genuinely
// missing, and only during the build phase.
const BUILD_PLACEHOLDERS: Record<keyof z.infer<typeof EnvSchema>, string> = {
  DATABASE_URL: "postgresql://placeholder@localhost/build-placeholder",
  DIRECT_URL: "postgresql://placeholder@localhost/build-placeholder",
  STRIPE_SECRET_KEY: "sk_test_buildplaceholder",
  STRIPE_WEBHOOK_SECRET: "whsec_buildplaceholder",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_buildplaceholder",
  STRIPE_PRICE_ID_PRO: "price_buildplaceholder",
  STRIPE_PRICE_ID_ENTERPRISE: "price_buildplaceholder",
  ANTHROPIC_API_KEY: "sk-ant-buildplaceholder",
};

function loadEnv(): z.infer<typeof EnvSchema> {
  const parsed = EnvSchema.safeParse(process.env);
  if (parsed.success) return parsed.data;

  // Any phase other than the build itself (next dev, next start, a real serverless invocation)
  // — fail loudly, exactly as before. This is the only path that ever ran prior to this change.
  if (!isProductionBuildPhase) throw parsed.error;

  const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  console.warn(
    `[env] Missing/invalid env var(s) during \`next build\`: ${missing}. Using build-only ` +
      "placeholders so the build can complete — this is expected for a CI build step that " +
      "doesn't serve real traffic. It is NOT expected for `next start`/`next dev`/a real " +
      "deployment, which still validate strictly and will fail loudly if truly misconfigured.",
  );

  const merged = Object.fromEntries(
    (Object.keys(BUILD_PLACEHOLDERS) as Array<keyof typeof BUILD_PLACEHOLDERS>).map((key) => [
      key,
      process.env[key] ?? BUILD_PLACEHOLDERS[key],
    ]),
  );
  return EnvSchema.parse(merged);
}

export const env = loadEnv();
