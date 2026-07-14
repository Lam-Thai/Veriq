import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

// Pinned per .claude/skills/ai-integration/SKILL.md — never resolved dynamically.
export const AI_MODEL = "claude-sonnet-4-6";

/**
 * Server-side Anthropic client singleton. `import "server-only"` turns an accidental import from
 * a "use client" component into a build error instead of leaking `ANTHROPIC_API_KEY` into the
 * browser bundle — see lib/stripe.ts / lib/stripe-price-map.ts for the same pattern already used
 * for Stripe's secret key in this repo.
 */
export const ai = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
