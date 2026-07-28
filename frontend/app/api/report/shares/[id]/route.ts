import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { loggerFor } from "@/lib/logger";
import { getInternalUserId } from "@/lib/report-jobs";
import { revokeShare } from "@/lib/report-shares";

// Prisma + Clerk — Node APIs, never Edge.
export const runtime = "nodejs";

const REVOKE_LIMIT = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Revokes one of the signed-in user's share links. Ownership is enforced inside
 * lib/report-shares.ts's revokeShare via a scoped `updateMany({ where: { id, userId, ... } })`,
 * so a zero-count result (not found, not owned, or already revoked) is indistinguishable here and
 * always surfaces as 404 — never 403 — matching the expenses/[id]/route.ts IDOR convention.
 */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/report/shares/[id]">) {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    const { success, resetAt } = checkRateLimit(`shares-revoke:${clerkUser.id}`, REVOKE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

    // No User row yet means no shares to revoke.
    const userId = await getInternalUserId(clerkUser.id);
    if (!userId) return ApiError.notFound();

    const { id } = await ctx.params;
    const revoked = await revokeShare(userId, id);
    if (!revoked) return ApiError.notFound();

    log.info({ shareId: id }, "[shares] revoked");
    return NextResponse.json({ data: { id } });
  } catch (err) {
    log.error({ err }, "[shares] revoke failed");
    return ApiError.internal();
  }
}
