import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { stateCookieName } from "@/lib/connect-flow";

// crypto.randomUUID() shape — bounds the value we'll echo back into a Set-Cookie header.
const STATE_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

/**
 * Entry point for a platform's login flow (popup target and same-tab fallback target alike).
 * Mints a CSRF state cookie bound to this platform, then hands off to the mock consent screen.
 * Real per-provider OAuth would redirect off-site from here instead — see
 * getAuthorizationUrl in platform-data.ts.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/connect/[slug]/authorize">) {
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
