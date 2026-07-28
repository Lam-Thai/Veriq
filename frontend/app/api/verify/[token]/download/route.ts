import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { getShareByToken, getReportPdfForShare } from "@/lib/report-shares";
import { loggerFor } from "@/lib/logger";

// Prisma via the pg driver adapter needs Node APIs — never Edge (same reason as
// app/api/report/[jobId]/route.ts, which this mirrors).
export const runtime = "nodejs";

// Keyed by the raw token itself, not a user id — there's no authenticated identity on this public
// route. Sized well above a legitimate single viewer's needs (one page load + a couple of retries)
// while still bounding brute-force abuse of any one token.
const RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Public PDF download for an active report-share link — no currentUser() check, since the caller
 * is whoever holds the link, not a signed-in Veriq user (see app/verify/[token]/page.tsx, the
 * counterpart public page this button lives on). Streams `ReportJob.pdfData` with the exact same
 * Content-Type/Content-Disposition shape as the owner-facing GET /api/report/[jobId] route, since
 * both read the same underlying fields.
 *
 * Not-found, revoked, and expired all collapse to the same 404 — matching the /verify page's
 * anti-enumeration reasoning: a viewer must never be able to distinguish "never existed" from
 * "lapsed" from this response alone. This route does not call recordView — the /verify page's
 * render already recorded the view for this visit, and calling it again here would double-count.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/verify/[token]/download">) {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  const { token } = await ctx.params;

  const { success, resetAt } = checkRateLimit(`verify-download:${token}`, RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

  const share = await getShareByToken(token);
  if (!share || share.revokedAt || share.expiresAt.getTime() <= Date.now()) {
    return ApiError.notFound();
  }

  // getShareByToken deliberately excludes pdfData (see its doc comment) — fetched here, only once
  // the share is confirmed active, so a merely-rendered verify page never pulls the PDF bytes.
  const reportJob = await getReportPdfForShare(share.reportJobId);
  const { pdfData, filename } = reportJob ?? { pdfData: null, filename: null };

  // A READY report's pdfData is kept indefinitely (see the ReportJob model's comment in
  // schema.prisma) — createShareIfAllowed only ever mints shares against a READY job, so a
  // missing pdfData here is a data-integrity bug, not an expected state.
  if (!pdfData) {
    log.error({ shareId: share.id, reportJobId: share.reportJobId }, "[verify-download] active share's job missing pdfData");
    return ApiError.notFound();
  }

  return new NextResponse(new Uint8Array(pdfData), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename ?? "income-report.pdf"}"`,
    },
  });
}
