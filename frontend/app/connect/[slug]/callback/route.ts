import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { isCallbackRequestBody, stateCookieName, type ConnectResult } from "@/lib/connect-flow";

/**
 * Hash both sides to a fixed-length digest before comparing so a length mismatch (e.g. a
 * tampered or garbage `state`) can't short-circuit the comparison and leak timing information.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Resolves a login attempt. Validates the submitted `state` against the HttpOnly cookie minted
 * by the authorize route — only the server that set that cookie could have produced a match, so
 * a caller can't forge an "approved" result for an attempt it didn't legitimately start.
 */
export async function POST(request: Request, ctx: RouteContext<"/connect/[slug]/callback">) {
  const { slug } = await ctx.params;
  const platform = findPlatformBySlug(slug);
  if (!platform) {
    return NextResponse.json({ error: "unknown_platform" }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isCallbackRequestBody(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const cookieName = stateCookieName(slug);
  const cookiePath = `/connect/${slug}`;
  const cookieState = cookieStore.get(cookieName)?.value;
  const stateValid = cookieState !== undefined && timingSafeEqualStrings(cookieState, body.state);
  // Single-use regardless of outcome — a replayed callback for this attempt must fail.
  cookieStore.delete({ name: cookieName, path: cookiePath });

  if (!stateValid) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  }

  const result: ConnectResult = body.decision === "approve" ? "approved" : "denied";
  return NextResponse.json({ result, slug });
}
