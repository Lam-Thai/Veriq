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
import { resolveUserPlan } from "@/lib/plan-resolution";
import { PLAN_LIMITS, type PlanLimits } from "@/lib/plan-limits";
import { ReportJobStatus } from "@/lib/generated/prisma/enums";

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * Clears the PDF bytes (not the row) off this user's own expired ReportJob rows. Called
 * opportunistically before creating a new job (see app/api/report/route.tsx) rather than via a
 * cron/scheduler — same "cheap inline cleanup, no scheduler" precedent lib/rate-limit.ts already
 * uses for its in-process buckets. The row itself survives so report history (getReportHistory
 * below) stays available after the PDF bytes are gone — only `pdfData`/`filename` are dropped;
 * `status`/`createdAt`/`platformsParam` are untouched.
 */
export async function clearExpiredReportJobPayloads(userId: string): Promise<void> {
  await db.reportJob.updateMany({
    where: { userId, expiresAt: { lt: new Date() }, pdfData: { not: null } },
    data: { pdfData: null, filename: null },
  });
}

/**
 * Date the user's most recent report stops being "current" under `limits`, or null if they're
 * free to generate a new one right now (no wait requirement, no prior/in-flight report, or the
 * prior report's window has already elapsed). A FAILED attempt doesn't cost the user their
 * window, but a still-rendering PENDING/PROCESSING job blocks immediately (an arbitrary "now" is
 * returned, since its real validity window won't be known until it reaches READY) — otherwise a
 * burst of concurrent POST /api/report calls fired while the first job is still rendering would
 * all see "no READY job yet" and each start their own render, bypassing this gate entirely for
 * the whole render duration. Shared by the hard server-side block in app/api/report/route.tsx
 * (which already has `userId`/`limits` resolved) and getNextReportAvailableAt below, so the date
 * math isn't duplicated.
 */
export async function getLastReportValidUntil(userId: string, limits: PlanLimits): Promise<Date | null> {
  if (!limits.requiresValidityWaitForNewReport) return null;

  const mostRecentBlocking = await db.reportJob.findFirst({
    where: { userId, status: { in: [ReportJobStatus.PENDING, ReportJobStatus.PROCESSING, ReportJobStatus.READY] } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, status: true },
  });
  if (!mostRecentBlocking) return null;
  if (mostRecentBlocking.status !== ReportJobStatus.READY) return new Date();

  const validUntil = new Date(mostRecentBlocking.createdAt.getTime() + limits.reportValidityDays * DAY_MS);
  return validUntil > new Date() ? validUntil : null;
}

/** Internal User.id for a Clerk id, or null if that user has never completed a connect flow
 * (no User row yet). Shared by the Clerk-id convenience wrappers below so the "no row → treat as
 * a brand-new user" resolution isn't duplicated, and exported for callers like
 * app/dashboard/page.tsx that need it once up front to call the userId-taking variants directly
 * (getLastReportValidUntil, getReportHistoryForUser) instead of re-resolving it per wrapper. */
export async function getInternalUserId(clerkId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } });
  return user?.id ?? null;
}

/** Clerk-id convenience wrapper around getLastReportValidUntil for page components that only
 * have a Clerk id on hand (see app/dashboard/report/page.tsx — app/dashboard/page.tsx already has
 * `userId`/`limits` resolved and calls getLastReportValidUntil directly). A user with no User row
 * yet has never generated a report, so is always free to (null). */
export async function getNextReportAvailableAt(clerkId: string): Promise<Date | null> {
  const userId = await getInternalUserId(clerkId);
  if (!userId) return null;

  const plan = await resolveUserPlan(clerkId);
  return getLastReportValidUntil(userId, PLAN_LIMITS[plan]);
}

export type ReportHistoryEntry = {
  id: string;
  status: ReportJobStatus;
  createdAt: Date;
  /** Raw comma-separated slugs from the request that created this job, or null for "all
   * connections at the time." Left for the caller to resolve into display names (see
   * report-panel.tsx) since that needs findPlatformBySlug, a client-safe lookup. */
  platformsParam: string | null;
  /** A READY job whose `expiresAt` has passed — its `pdfData` may or may not have been cleared
   * yet by clearExpiredReportJobPayloads, so this is derived from `expiresAt` rather than trusted
   * from `status` alone (no new "EXPIRED" enum value was added — see schema.prisma). */
  isExpired: boolean;
  /** Only set for READY jobs — computed from the *current* resolved plan's reportValidityDays,
   * since no schema change added a per-job plan snapshot. */
  validUntil: Date | null;
};

/**
 * Up to the 25 most recent report jobs for this user, newest first — metadata-only history that
 * survives PDF expiry (see clearExpiredReportJobPayloads above). Shown in the dashboard's Report
 * tab regardless of whether the underlying PDF bytes are still downloadable. Takes an already-
 * resolved internal `userId`/`reportValidityDays` — see getReportHistory below for the Clerk-id
 * convenience wrapper.
 */
export async function getReportHistoryForUser(userId: string, reportValidityDays: number): Promise<ReportHistoryEntry[]> {
  const jobs = await db.reportJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 25,
    select: { id: true, status: true, createdAt: true, platformsParam: true, expiresAt: true },
  });

  const now = new Date();
  return jobs.map((job) => ({
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    platformsParam: job.platformsParam,
    isExpired: job.status === ReportJobStatus.READY && job.expiresAt < now,
    validUntil:
      job.status === ReportJobStatus.READY ? new Date(job.createdAt.getTime() + reportValidityDays * DAY_MS) : null,
  }));
}

/** Clerk-id convenience wrapper around getReportHistoryForUser for page components that only
 * have a Clerk id on hand (see app/dashboard/report/page.tsx — app/dashboard/page.tsx already has
 * `userId`/`limits` resolved and calls getReportHistoryForUser directly). */
export async function getReportHistory(clerkId: string): Promise<ReportHistoryEntry[]> {
  const userId = await getInternalUserId(clerkId);
  if (!userId) return [];

  const plan = await resolveUserPlan(clerkId);
  return getReportHistoryForUser(userId, PLAN_LIMITS[plan].reportValidityDays);
}

export type CreateReportJobResult = { ok: true; jobId: string } | { ok: false; validUntil: Date };

/**
 * Re-checks the validity gate and creates the PENDING job in a single transaction, under the
 * same transaction-scoped advisory lock app/connect/[slug]/callback/route.ts uses — closes the
 * narrow race between app/api/report/route.tsx's pre-check (getLastReportValidUntil) and this
 * creation, where two requests could otherwise both pass the pre-check before either's job
 * exists. `userId` is this app's internal User.id, not the Clerk id.
 */
export async function createReportJobIfAllowed(
  userId: string,
  limits: PlanLimits,
  platformsParam: string | null,
): Promise<CreateReportJobResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

    if (limits.requiresValidityWaitForNewReport) {
      const blocking = await tx.reportJob.findFirst({
        where: {
          userId,
          status: { in: [ReportJobStatus.PENDING, ReportJobStatus.PROCESSING, ReportJobStatus.READY] },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true },
      });
      if (blocking) {
        const validUntil =
          blocking.status === ReportJobStatus.READY
            ? new Date(blocking.createdAt.getTime() + limits.reportValidityDays * DAY_MS)
            : new Date();
        if (validUntil > new Date()) return { ok: false, validUntil };
      }
    }

    const job = await tx.reportJob.create({
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
    return { ok: true, jobId: job.id };
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
