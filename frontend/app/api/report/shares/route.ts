import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { loggerFor } from "@/lib/logger";
import { getInternalUserId } from "@/lib/report-jobs";
import { createShareSchema, createShareIfAllowed, MAX_ACTIVE_SHARES_PER_REPORT } from "@/lib/report-shares";

// Prisma + Clerk — Node APIs, never Edge.
export const runtime = "nodejs";

// Share creation is cheap-to-hammer (mints a token, writes a row) but a legitimate owner only
// ever creates a handful of links per report, so this stays generous relative to the per-report
// cap of MAX_ACTIVE_SHARES_PER_REPORT itself.
const CREATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 600_000;

/**
 * Mints a new share link for one of the signed-in user's READY reports. The raw bearer token is
 * returned in this response only — lib/report-shares.ts never persists it, only its sha256 hash —
 * so this is the one and only place a caller can ever read it back.
 */
export async function POST(request: NextRequest) {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    const { success, resetAt } = checkRateLimit(`shares-create:${clerkUser.id}`, CREATE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return ApiError.badRequest("Request body must be valid JSON");
    }

    const parsed = createShareSchema.safeParse(body);
    if (!parsed.success) return ApiError.unprocessable(parsed.error);

    // No User row yet means no reports and no shares — same "brand-new user" resolution as
    // getInternalUserId's other callers (lib/report-jobs.tsx).
    const userId = await getInternalUserId(clerkUser.id);
    if (!userId) return ApiError.notFound();

    const result = await createShareIfAllowed(userId, parsed.data.reportJobId, parsed.data.expiresAt);
    if (!result.ok) {
      if (result.reason === "not_found") return ApiError.notFound();
      return ApiError.conflict(
        "SHARE_CAP_REACHED",
        `This report already has the maximum of ${MAX_ACTIVE_SHARES_PER_REPORT} active share links — revoke one before creating another.`,
      );
    }

    log.info({ shareId: result.shareId }, "[shares] created");
    return NextResponse.json(
      { data: { shareId: result.shareId, url: `${request.nextUrl.origin}/verify/${result.rawToken}` } },
      { status: 201 },
    );
  } catch (err) {
    log.error({ err }, "[shares] create failed");
    return ApiError.internal();
  }
}
