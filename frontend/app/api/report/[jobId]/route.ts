import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { loggerFor } from "@/lib/logger";

// Reads Prisma via the pg driver adapter — needs Node APIs, never Edge.
export const runtime = "nodejs";

// A poller hitting this every ~1s while a job renders is expected traffic, not abuse — sized to
// comfortably cover the client's full polling budget (hooks/use-report-download.ts polls up to
// MAX_POLLS=120 times at POLL_INTERVAL_MS=1000, i.e. up to 120 requests over ~120s) plus margin,
// not just the 5/5min limit on job creation (app/api/report/route.tsx). A tighter window here
// would start 429ing a single legitimate poller partway through a genuinely slow render.
const RATE_LIMIT = 150;
const RATE_LIMIT_WINDOW_MS = 120_000;

/**
 * Polls (and ultimately downloads) an async report job created by `POST /api/report` — and, since
 * a READY job's `pdfData` is kept indefinitely, also serves as the direct download link for any
 * past job in the dashboard's Report history (see report-panel.tsx's plain `<a href>` per row;
 * no polling needed there since the job is already READY). Ownership is enforced via the relation
 * filter below (`user.clerkId`), not a bare `id` lookup — see .claude/skills/security/SKILL.md's
 * ownership pattern — so a job id alone never lets one user read another's report; a job that
 * doesn't belong to the caller 404s exactly like one that doesn't exist (no 403 — see the same
 * skill's "404 for ownership failures" rule).
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/report/[jobId]">) {
  const clerkUser = await currentUser();
  if (!clerkUser) return ApiError.unauthorized();

  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  const { success, resetAt } = checkRateLimit(`report-status:${clerkUser.id}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

  const { jobId } = await ctx.params;

  const job = await db.reportJob.findFirst({
    where: { id: jobId, user: { clerkId: clerkUser.id } },
    select: { status: true, pdfData: true, filename: true },
  });
  if (!job) return ApiError.notFound();

  if (job.status === "PENDING" || job.status === "PROCESSING") {
    return NextResponse.json({ data: { status: job.status } }, { status: 202 });
  }

  if (job.status === "FAILED") {
    log.warn({ jobId }, "[report] poller fetched a FAILED job");
    return ApiError.internal();
  }

  // READY — a job's pdfData is kept indefinitely (see the ReportJob model's comment in
  // schema.prisma), so a missing pdfData/filename here is a data-integrity bug, not an expected
  // "expired" state.
  if (!job.pdfData || !job.filename) {
    log.error({ jobId }, "[report] job marked READY but missing pdfData/filename");
    return ApiError.internal();
  }

  return new NextResponse(new Uint8Array(job.pdfData), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${job.filename}"`,
    },
  });
}
