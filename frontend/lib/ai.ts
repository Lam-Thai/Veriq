import "server-only";
import { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/env";

// `gemini-flash-latest` is Google's alias that it hot-swaps to whatever the current stable Flash
// release is (see https://ai.google.dev/gemini-api/docs/models/gemini) — used instead of a
// hardcoded version string so "latest" stays true without this app rotting on an old pin.
// Trade-off: behavior can shift silently on Google's own release cadence (Google gives a 2-week
// deprecation notice by email, but there is no code-level pin here to catch a behavior change
// before it reaches production). Flash/Flash-Lite are also the only tiers still covered by
// Google's free tier as of writing — Pro models moved to paid-only — so this alias, not
// `gemini-pro-latest`, is the one that keeps this feature billing-free. The moment the underlying
// Google Cloud/AI Studio project has billing enabled, the free tier disappears entirely and every
// call below becomes billable regardless of which model alias is used.
export const AI_MODEL = "gemini-flash-latest";

/**
 * Server-side Gemini client singleton. `import "server-only"` turns an accidental import from
 * a "use client" component into a build error instead of leaking `GEMINI_API_KEY` into the
 * browser bundle — see lib/stripe.ts / lib/stripe-price-map.ts for the same pattern already used
 * for Stripe's secret key in this repo.
 *
 * `GEMINI_API_KEY` is optional in lib/env.ts (see that file for why), so it may be `undefined`
 * here. Constructing the client with an empty string rather than `undefined` is deliberate: it
 * keeps this module-scope statement from ever throwing on import (the SDK's own validation, if
 * any, happens lazily on the first real request), leaving lib/ai/income-narrative.ts's explicit
 * `isAiConfigured()` check as the single place that decides whether to attempt a call at all.
 */
export const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY ?? "" });

export function isAiConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}
