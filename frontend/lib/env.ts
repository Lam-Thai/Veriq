import { z } from "zod";
import { logger } from "@/lib/logger";

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
  // NEXT_PUBLIC_ and never logged. A plain non-empty check rather than a prefix assumption (e.g.
  // "AIza...") because Google AI Studio key formats aren't reliably confirmed to be stable across
  // all current key-issuance paths — a wrong prefix guess would risk rejecting a real valid key.
  //
  // Optional, unlike every other secret in this schema: the AI narrative feature is explicitly
  // additive/non-blocking (dashboard and report must render fully without it). Every field in
  // this schema is validated together in one `safeParse` below, and this file is imported
  // transitively by lib/db.ts -> lib/dashboard-data.ts -> the dashboard page — so making this
  // field required would mean a missing AI key 500s the *entire* dashboard, not just the AI
  // card. lib/ai/income-narrative.ts checks for its presence itself and degrades to a typed
  // "error" result when absent, so validation happens at first *use*, not at process boot.
  GEMINI_API_KEY: z.string().min(1).optional(),
  // Shared HMAC secret for signing/verifying the short-lived service-token JWT this app uses to
  // call the FastAPI backend (see lib/service-token.ts and .claude/skills/security/SKILL.md's
  // "Service Tokens" section) — must match FastAPI's INTERNAL_JWT_SECRET exactly. Required, not
  // optional: unlike GEMINI_API_KEY this isn't an additive feature, it's the auth mechanism for
  // the backend service this app is built around.
  INTERNAL_JWT_SECRET: z.string().min(32),
  // Base URL of the FastAPI backend (e.g. http://localhost:8000, or the deployed service URL).
  FASTAPI_URL: z.url(),
  // Sentry DSN for error tracking/APM. Optional — the Sentry SDK no-ops when unset (see
  // instrumentation.ts), so local dev and CI never need a real project configured.
  SENTRY_DSN: z.string().min(1).optional(),
  // Same Sentry DSN, exposed to the browser bundle for client-side error capture
  // (instrumentation-client.ts, app/global-error.tsx). A DSN is a public project identifier, not
  // a secret — safe to inline client-side, same as NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY below.
  NEXT_PUBLIC_SENTRY_DSN: z.string().min(1).optional(),
  // Resend API key — sends the "your shared report was viewed" notification email from
  // lib/email.ts. Optional, same reasoning as GEMINI_API_KEY: the notification is a nice-to-have
  // layered on top of the public /verify page, not something that page's core job (rendering a
  // shared report) can be allowed to depend on. lib/email.ts checks for this itself at call time
  // and warns-and-returns when it's absent, so an unconfigured key degrades to "no email sent",
  // never to a broken verify page.
  RESEND_API_KEY: z.string().min(1).optional(),
  // Verified "from" address for the email above. Optional and independent of RESEND_API_KEY being
  // set — Resend requires sending from a domain verified in its dashboard, which this repo won't
  // have configured in most environments, so lib/email.ts falls back to a placeholder sender
  // address rather than requiring this too.
  RESEND_FROM_EMAIL: z.string().email().optional(),
  // Inbox the /help contact form delivers to (lib/email.ts's sendContactEmail). Optional for the
  // same reason as RESEND_API_KEY above, and load-bearing in the same way: with either one unset
  // there is nowhere to deliver to, so app/api/contact/route.ts reports the feature as
  // unconfigured and components/help/contact-form.tsx degrades to a "email us directly" notice
  // instead of a form that silently swallows messages. Never exposed client-side — the form
  // learns *that* contact is unavailable from a server-rendered boolean, never the address
  // itself, so this can't be scraped off the help page by address harvesters.
  CONTACT_FORM_TO: z.string().email().optional(),
  // Salt mixed into the coarsened-IP hash on a report share's view log (lib/ip-privacy.ts) —
  // `min(16)` so a trivially short/guessable value can't be configured. Never logged.
  //
  // Optional, like GEMINI_API_KEY above: the view log's IP hash is additive UX (the owner sees
  // *when* and *what browser*, an IP hash is a nice-to-have on top), never load-bearing for the
  // share/reveal flow itself. lib/ip-privacy.ts checks for its presence and degrades to storing
  // `ipHash: null` when absent — it deliberately never falls back to hashing without a salt, since
  // an unsalted hash of a coarsened IP is a small enough space to be practically reversible.
  REPORT_SHARE_IP_SALT: z.string().min(16).optional(),
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
  GEMINI_API_KEY: "gemini-buildplaceholder",
  INTERNAL_JWT_SECRET: "build-placeholder-secret-at-least-32-chars",
  FASTAPI_URL: "http://localhost:8000",
  SENTRY_DSN: "build-placeholder-dsn",
  NEXT_PUBLIC_SENTRY_DSN: "build-placeholder-dsn",
  RESEND_API_KEY: "resend-buildplaceholder",
  RESEND_FROM_EMAIL: "build-placeholder@example.com",
  CONTACT_FORM_TO: "build-placeholder@example.com",
  REPORT_SHARE_IP_SALT: "build-placeholder-salt-16-chars",
};

function loadEnv(): z.infer<typeof EnvSchema> {
  const parsed = EnvSchema.safeParse(process.env);
  if (parsed.success) return parsed.data;

  // Any phase other than the build itself (next dev, next start, a real serverless invocation)
  // — fail loudly, exactly as before. This is the only path that ever ran prior to this change.
  if (!isProductionBuildPhase) throw parsed.error;

  const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  logger.warn(
    { missing },
    "[env] Missing/invalid env var(s) during `next build` — using build-only placeholders so " +
      "the build can complete. This is expected for a CI build step that doesn't serve real " +
      "traffic; it is NOT expected for `next start`/`next dev`/a real deployment, which still " +
      "validate strictly and fail loudly if truly misconfigured.",
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
