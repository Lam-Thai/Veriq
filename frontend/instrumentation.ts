import * as Sentry from "@sentry/nextjs";

/**
 * Server-side Sentry bootstrap (Next.js's `instrumentation.ts` convention — replaces the older
 * `sentry.server.config.ts`/`sentry.edge.config.ts` pair). Runs once per server instance, before
 * any request is handled. `register()` is called for both the nodejs and edge runtimes; this app
 * doesn't use the edge runtime today (see runtime = "nodejs" comments throughout app/api/**), but
 * initializing unconditionally here is what Sentry's own docs recommend so it's covered if that
 * changes.
 *
 * Reads `SENTRY_DSN` directly from `process.env` rather than importing `@/lib/env` — this file
 * must be side-effect-free to import even when unrelated required env vars (DATABASE_URL, Stripe
 * keys, ...) are missing, e.g. during `next build`'s module analysis. Sentry's SDK itself already
 * no-ops safely when `dsn` is undefined.
 */
export function register() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    // Local dev / CI never have a real DSN configured — keep that silent instead of warning on
    // every single server start.
    enabled: Boolean(process.env.SENTRY_DSN),
  });
}

export const onRequestError = Sentry.captureRequestError;
