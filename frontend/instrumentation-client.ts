import * as Sentry from "@sentry/nextjs";

// Client-side Sentry bootstrap (Next.js's `instrumentation-client.ts` convention). Must read
// `NEXT_PUBLIC_SENTRY_DSN` directly — this file ships in the browser bundle, so it can only ever
// see `NEXT_PUBLIC_*` values, never `@/lib/env` (which validates server-only secrets that don't
// exist in the browser). A DSN is a public project identifier, not a secret.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
});

// Required export so the SDK can instrument App Router client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
