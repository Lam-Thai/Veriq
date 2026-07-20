import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { getUserConnections } from "@/lib/dashboard-data";
import { db } from "@/lib/db";
import { createReportJob, deleteExpiredReportJobs, filterConnections, runReportJob } from "@/lib/report-jobs";
import { loggerFor } from "@/lib/logger";

// Prisma's pg driver adapter needs Node APIs (net/tls) — this route can never run on the Edge
// runtime.
export const runtime = "nodejs";

// PDF rendering is the single heaviest operation in this app, and each accepted request now also
// schedules a real after()-run render (not just validates and returns) — tighter than
// checkout's 5/min (app/api/checkout/route.ts), on a 5 minute window instead of 1.
const RATE_LIMIT = 5;
const RATE_LIMIT_WINDOW_MS = 5 * 60_000;

/**
 * Starts an async render of the signed-in user's verified-income report as a PDF. An optional
 * `?platforms=slug1,slug2` query param (set by the report-builder UI) restricts which connected
 * platforms are included; omitting it — as the dashboard's quick-download link does — includes
 * all of the user's connections.
 *
 * Returns `202 { data: { jobId } }` immediately — the actual `renderToBuffer` call (the CPU-heavy
 * part) runs after the response is sent (see lib/report-jobs.tsx's `runReportJob`, scheduled via
 * Next.js's `after()` below) so a slow render never ties up this request/serverless invocation.
 * Poll `GET /api/report/[jobId]` for the result. See README's "Where new work goes" section for
 * why this stays in Next.js rather than moving to FastAPI.
 */
export async function POST(request: NextRequest) {
  const clerkUser = await currentUser();
  if (!clerkUser) return ApiError.unauthorized();

  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  const { success, resetAt } = checkRateLimit(`report:${clerkUser.id}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

  const connections = await getUserConnections(clerkUser.id);
  if (connections.length === 0) {
    return ApiError.conflict("NO_CONNECTIONS", "Connect at least one platform before generating a report.");
  }

  const platformsParam = request.nextUrl.searchParams.get("platforms");
  const selectedConnections = filterConnections(connections, platformsParam);
  if (selectedConnections.length === 0) {
    return ApiError.conflict("NO_PLATFORMS_SELECTED", "Select at least one platform to include in the report.");
  }

  // A User row is guaranteed to exist here: `connections.length > 0` above is only possible if a
  // PlatformConnection row exists, and that FKs to User.id (see app/connect/[slug]/callback).
  const user = await db.user.findUniqueOrThrow({ where: { clerkId: clerkUser.id }, select: { id: true } });

  await deleteExpiredReportJobs(user.id).catch((err: unknown) => {
    log.warn({ err }, "[report] expired-job cleanup failed");
  });

  const job = await createReportJob(user.id, platformsParam);

  after(() => runReportJob(job.id, clerkUser, platformsParam));

  log.info({ jobId: job.id }, "[report] job created");

  return NextResponse.json({ data: { jobId: job.id } }, { status: 202 });
}
