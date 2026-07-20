import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { STATE_PATTERN, stateCookieName } from "@/lib/connect-flow";
import { checkRateLimit } from "@/lib/rate-limit";
import { ApiError } from "@/lib/api-error";

// Generous enough for a user clicking through several platforms' mock login flows in quick
// succession, tight enough to bound abuse of this cookie-minting step.
const RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Entry point for a platform's login flow (popup target and same-tab fallback target alike).
 * Mints a CSRF state cookie bound to this platform, then hands off to the mock consent screen.
 * Real per-provider OAuth would redirect off-site from here instead — see
 * getAuthorizationUrl in platform-data.ts.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/connect/[slug]/authorize">) {
  // Defensive — proxy.ts already gates /connect(.*) behind Clerk auth (see the callback route's
  // identical comment), so `userId` is always present here in practice.
  const { userId } = await auth();
  if (!userId) return ApiError.unauthorized();

  const { success, resetAt } = checkRateLimit(`connect-authorize:${userId}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

  const { slug } = await ctx.params;
  const platform = findPlatformBySlug(slug);
  if (!platform) {
    return NextResponse.json({ error: "unknown_platform" }, { status: 404 });
  }

  const state = request.nextUrl.searchParams.get("state");
  if (!state || !STATE_PATTERN.test(state)) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  }

  const cookieStore = await cookies();
  cookieStore.set(stateCookieName(slug), state, {
    httpOnly: true,
    // dev runs on plain HTTP — an unconditional `secure` cookie would silently never be set.
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: `/connect/${slug}`,
    maxAge: 300,
  });

  const consentUrl = new URL(`/connect/${slug}/consent`, request.nextUrl.origin);
  consentUrl.searchParams.set("state", state);
  return NextResponse.redirect(consentUrl, 307);
}
