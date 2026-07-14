import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateIncomeNarrative } from "@/lib/ai/income-narrative";
import type { IncomeInsightsData } from "@/lib/prompts/income-narrative";

// Calls Gemini (via lib/ai/income-narrative.ts) and Prisma — needs Node APIs, never Edge.
export const runtime = "nodejs";

// Generous enough for normal dashboard/report usage (the service caches its result per-user for
// 24h, see lib/ai/income-narrative.ts) while still bounding how often one user can trigger a
// fresh Gemini call. See lib/rate-limit.ts for the single-instance caveat.
const RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Google's Gemini free tier is rate-limited per Google Cloud/AI Studio *project*, not per API key
// or per end-user — so the per-user limit above does nothing to stop many different users from
// collectively blowing through the shared project-wide free quota. This second, unkeyed check
// (same key for every request, `checkRateLimit`'s existing single-instance in-memory bucket) is a
// coarse global throttle against that. The published free-tier RPM/RPD numbers weren't reliably
// confirmed from official docs at the time this was written (only from unofficial aggregator
// blogs, not trustworthy for a hardcoded limit) — 8 req/60s is a conservative placeholder. Check
// the live number at https://aistudio.google.com/rate-limit before loosening this.
const GLOBAL_RATE_LIMIT_KEY = "income-insights:global";
const GLOBAL_RATE_LIMIT = 8;
const GLOBAL_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Returns the signed-in user's AI-generated income summary. Always scoped to the caller's own
 * Clerk session — never accepts a userId/platform list from the request, so there's no way to
 * widen this to another user's data (see .claude/skills/security/SKILL.md's IDOR guidance).
 */
export async function GET() {
  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    const { success } = checkRateLimit(`income-insights:${clerkUser.id}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests();

    const { success: globalSuccess } = checkRateLimit(
      GLOBAL_RATE_LIMIT_KEY,
      GLOBAL_RATE_LIMIT,
      GLOBAL_RATE_LIMIT_WINDOW_MS,
    );
    if (!globalSuccess) return ApiError.tooManyRequests();

    const result = await generateIncomeNarrative(clerkUser.id);

    if (result.status === "error") return ApiError.internal();

    const data: IncomeInsightsData =
      result.status === "no_data" ? { status: "no_data" } : { status: "ok", insights: result.data };

    return NextResponse.json({ data });
  } catch (err) {
    console.error("[ai-income-insights] unhandled error", err);
    return ApiError.internal();
  }
}
