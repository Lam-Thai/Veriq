import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import type { User } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getUserConnections, type UserConnection } from "@/lib/dashboard-data";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { MONTHLY_BARS } from "@/lib/monthly-bars";
import { ReportDocument, type ReportData, type ReportNarrative } from "@/lib/report-pdf";
import { generateIncomeNarrative } from "@/lib/ai/income-narrative";
import { logger } from "@/lib/logger";

// How long a READY job's PDF bytes stay downloadable before being treated as expired — long
// enough for a slow client/poll to still fetch it, short enough not to keep stale report bytes
// around in Postgres indefinitely (see the ReportJob model's comment in schema.prisma).
const READY_TTL_MS = 15 * 60 * 1000;
// FAILED rows are kept a bit longer than READY ones so a failure is actually inspectable
// (logs/DB) rather than vanishing before anyone notices.
const FAILED_TTL_MS = 60 * 60 * 1000;

// `platformsParam` is a raw, client-supplied comma-separated string, so this only ever narrows
// `connections` (already scoped to the authed user) down by intersection — it can never widen
// the result to include another user's data.
export function filterConnections(connections: UserConnection[], platformsParam: string | null): UserConnection[] {
  if (platformsParam === null) return connections;

  const requestedSlugs = new Set(
    platformsParam
      .split(",")
      .map((slug) => slug.trim())
      .filter(Boolean),
  );
  return connections.filter((connection) => requestedSlugs.has(connection.slug));
}

function buildReportData(clerkUser: User, connections: UserConnection[]): ReportData {
  const userName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    clerkUser.primaryEmailAddress?.emailAddress ||
    "Veriq user";

  const bySource = connections
    .map((connection) => ({
      name: findPlatformBySlug(connection.slug)?.name ?? connection.slug,
      amount: connection.verifiedAmount,
    }))
    .sort((a, b) => b.amount - a.amount);

  const totalVerified = connections.reduce((sum, connection) => sum + connection.verifiedAmount, 0);
  const rangeLabel = `${MONTHLY_BARS.at(0)!.month} – ${MONTHLY_BARS.at(-1)!.month} ${new Date().getFullYear()}`;

  return { generatedAt: new Date(), userName, rangeLabel, totalVerified, bySource };
}

/**
 * Deletes this user's own expired ReportJob rows. Called opportunistically before creating a new
 * job (see app/api/report/route.tsx) rather than via a cron/scheduler — same "cheap inline
 * cleanup, no scheduler" precedent lib/rate-limit.ts already uses for its in-process buckets.
 */
export async function deleteExpiredReportJobs(userId: string): Promise<void> {
  await db.reportJob.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
}

/** Creates a PENDING job row. `userId` is this app's internal User.id, not the Clerk id. */
export async function createReportJob(userId: string, platformsParam: string | null): Promise<{ id: string }> {
  return db.reportJob.create({
    data: {
      userId,
      status: "PENDING",
      platformsParam,
      // Conservative expiry up front (the FAILED window) — runReportJob narrows this to the
      // shorter READY_TTL_MS once the render actually succeeds.
      expiresAt: new Date(Date.now() + FAILED_TTL_MS),
    },
    select: { id: true },
  });
}

/**
 * Does the actual heavy work (income-narrative fetch + `renderToBuffer`) and writes the outcome
 * back to the job row. Scheduled via Next.js's `after()` from the POST /api/report handler so
 * none of this ever runs on the request/response path — see README's "Where new work goes"
 * section for why this stays in Next.js/TypeScript rather than moving to FastAPI.
 */
export async function runReportJob(jobId: string, clerkUser: User, platformsParam: string | null): Promise<void> {
  const startedAt = Date.now();
  const log = logger.child({ jobId, userId: clerkUser.id });

  try {
    await db.reportJob.update({ where: { id: jobId }, data: { status: "PROCESSING" } });

    const connections = await getUserConnections(clerkUser.id);
    const selectedConnections = filterConnections(connections, platformsParam);
    if (selectedConnections.length === 0) {
      throw new Error("No platforms selected");
    }

    const data = buildReportData(clerkUser, selectedConnections);

    // Additive only — see the original inline comment this was extracted from (git history /
    // lib/ai/income-narrative.ts) for the full IDOR/consistency reasoning. A failed, slow, or
    // rate-limited narrative call must never fail the whole report.
    let narrative: ReportNarrative | undefined;
    const isFullSelection = selectedConnections.length === connections.length;
    if (isFullSelection) {
      try {
        const narrativeResult = await generateIncomeNarrative(clerkUser.id);
        if (narrativeResult.status === "ok") {
          narrative = {
            text: narrativeResult.data.narrative,
            stabilityRating: narrativeResult.data.stabilityRating,
            trendDirection: narrativeResult.data.trendDirection,
            diversificationSummary: narrativeResult.data.diversificationSummary,
          };
        }
      } catch (err) {
        log.warn({ err }, "[report-job] income narrative unavailable, rendering report without it");
      }
    }
    if (narrative) data.narrative = narrative;

    const buffer = await renderToBuffer(<ReportDocument data={data} />);
    const filename = `veriq-verified-income-report-${new Date().toISOString().slice(0, 10)}.pdf`;

    await db.reportJob.update({
      where: { id: jobId },
      data: {
        status: "READY",
        // Prisma's Bytes field wants a plain Uint8Array<ArrayBuffer> — Node's Buffer is a
        // Uint8Array subclass but typed against the wider ArrayBufferLike, so it isn't assignable
        // as-is even though the bytes are identical.
        pdfData: new Uint8Array(buffer),
        filename,
        expiresAt: new Date(Date.now() + READY_TTL_MS),
      },
    });

    log.info({ durationMs: Date.now() - startedAt }, "[report-job] rendered");
  } catch (err) {
    log.error({ err, durationMs: Date.now() - startedAt }, "[report-job] failed");
    await db.reportJob
      .update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          error: "Report generation failed",
          expiresAt: new Date(Date.now() + FAILED_TTL_MS),
        },
      })
      .catch((updateErr) => {
        log.error({ err: updateErr }, "[report-job] failed to persist FAILED status");
      });
  }
}
