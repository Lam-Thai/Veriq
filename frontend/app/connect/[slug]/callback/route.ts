import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";
import { currentUser } from "@clerk/nextjs/server";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { isCallbackRequestBody, stateCookieName, type ConnectResult } from "@/lib/connect-flow";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { loggerFor } from "@/lib/logger";
import { db } from "@/lib/db";

// Same window/limit as the authorize route this pairs with — see that file's comment.
const RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

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
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

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

  // Defensive — proxy.ts already gates /connect(.*) behind Clerk auth, but this route must never
  // persist a connection without a real signed-in user to attribute it to.
  const clerkUser = await currentUser();
  if (!clerkUser) return ApiError.unauthorized();

  const { success, resetAt } = checkRateLimit(`connect-callback:${clerkUser.id}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

  const result: ConnectResult = body.decision === "approve" ? "approved" : "denied";

  if (result === "approved") {
    const email = clerkUser.primaryEmailAddress?.emailAddress;
    if (!email) {
      log.error({ clerkId: clerkUser.id }, "[connect callback] clerk user has no primary email");
      return ApiError.internal();
    }

    try {
      const user = await db.user.upsert({
        where: { clerkId: clerkUser.id },
        create: { clerkId: clerkUser.id, email },
        update: {},
        select: { id: true },
      });

      // Upsert, not create — reconnecting an already-connected platform updates the snapshot
      // instead of erroring or creating a duplicate row.
      await db.platformConnection.upsert({
        where: { userId_slug: { userId: user.id, slug } },
        create: { userId: user.id, slug, verifiedAmount: platform.verifiedAmount },
        update: { verifiedAmount: platform.verifiedAmount },
      });
    } catch (err) {
      log.error({ err, clerkId: clerkUser.id, slug }, "[connect callback] failed to persist connection");
      return ApiError.internal();
    }
  }

  return NextResponse.json({ result, slug });
}
