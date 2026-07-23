import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { loggerFor } from "@/lib/logger";
import { db } from "@/lib/db";

// Lightweight per-user mutation, same window/limit precedent as the connect callback route.
const RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Removes the signed-in user's connection to one platform. Ownership is enforced via the relation
 * filter below (`user.clerkId`), not a bare slug lookup — same IDOR-safe pattern
 * app/api/report/[jobId]/route.ts documents — so a caller can never affect another user's
 * connections. `deleteMany` rather than `delete` since we only have slug+ownership, not the
 * PlatformConnection's own id.
 */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/connections/[slug]">) {
  const clerkUser = await currentUser();
  if (!clerkUser) return ApiError.unauthorized();

  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  const { success, resetAt } = checkRateLimit(`disconnect:${clerkUser.id}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

  const { slug } = await ctx.params;
  if (!findPlatformBySlug(slug)) return ApiError.notFound();

  const { count } = await db.platformConnection.deleteMany({
    where: { slug, user: { clerkId: clerkUser.id } },
  });
  if (count === 0) return ApiError.notFound();

  log.info({ slug }, "[connections] disconnected");
  return NextResponse.json({ data: { slug } });
}
