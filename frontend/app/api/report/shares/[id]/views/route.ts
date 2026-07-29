import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { loggerFor } from "@/lib/logger";
import { getInternalUserId } from "@/lib/report-jobs";
import { getViewsForShare } from "@/lib/report-shares";

// Prisma + Clerk — Node APIs, never Edge.
export const runtime = "nodejs";

const VIEWS_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Owner-scoped view log for one share link, lazy-fetched when a row is expanded in the dashboard's
 * Sharing tab. `ipHash` is an opaque, already-coarsened+salted sha256 digest (see lib/ip-privacy.ts)
 * — returned as-is, never further processed here, since it carries no recoverable location.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/report/shares/[id]/views">) {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    const { success, resetAt } = checkRateLimit(`shares-views:${clerkUser.id}`, VIEWS_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

    // No User row yet means no shares, so no views to list.
    const userId = await getInternalUserId(clerkUser.id);
    if (!userId) return ApiError.notFound();

    const { id } = await ctx.params;

    // Keyset pagination, same envelope shape as GET /api/expenses. `limit` is clamped inside
    // getViewsForShare rather than trusted raw; an absent/garbage value falls back to the default.
    const url = new URL(request.url);
    const limitParam = Number(url.searchParams.get("limit"));
    const page = await getViewsForShare(userId, id, {
      limit: Number.isInteger(limitParam) && limitParam > 0 ? limitParam : undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    if (page === null) return ApiError.notFound();

    return NextResponse.json({ data: page.views, meta: { nextCursor: page.nextCursor } });
  } catch (err) {
    log.error({ err }, "[shares] list views failed");
    return ApiError.internal();
  }
}
