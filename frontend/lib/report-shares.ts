import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ReportJobStatus } from "@/lib/generated/prisma/enums";

/**
 * Owner-facing share-link domain: minting/hashing the bearer token, the race-safe create/revoke/
 * view-recording helpers, and the DTOs the API routes and dashboard hand back to the client.
 * Mirrors the layering of lib/report-jobs.tsx — `db` import, `$transaction` + advisory-lock
 * pattern, and the "internal userId, not Clerk id" convention all match.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_ACTIVE_SHARES_PER_REPORT = 10;
export const MAX_SHARE_EXPIRY_DAYS = 90;

/**
 * Validates a share-creation request: `reportJobId` must be a real cuid (existence/ownership/
 * READY-status are re-checked server-side in `createShareIfAllowed`, not here — this schema only
 * validates shape), and `expiresAt` must be a real future date within `MAX_SHARE_EXPIRY_DAYS`.
 */
export const createShareSchema = z
  .object({
    reportJobId: z.string().cuid(),
    expiresAt: z.coerce.date(),
  })
  .refine((body) => body.expiresAt.getTime() > Date.now(), {
    message: "Expiry must be in the future",
    path: ["expiresAt"],
  })
  .refine((body) => body.expiresAt.getTime() <= Date.now() + MAX_SHARE_EXPIRY_DAYS * DAY_MS, {
    message: `Expiry can be at most ${MAX_SHARE_EXPIRY_DAYS} days out`,
    path: ["expiresAt"],
  });

export type CreateShareInput = z.infer<typeof createShareSchema>;

// crypto.randomUUID()-style precedent in lib/connect-flow.ts's STATE_PATTERN, but this token is
// the entire access control for a real report (live up to 90 days, sent over channels the app
// doesn't control) so it's minted from 32 random bytes rather than a UUID's ~122 bits. base64url
// of 32 bytes is always exactly 43 characters (no padding), which is what this pattern pins down.
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Mints a fresh 256-bit bearer token for a new share link. Only ever kept in memory long enough
 * to return it once in the create response and to hash it for storage — never persisted raw. */
export function mintShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex digest of a raw share token — the only form ever persisted (`ReportShare.tokenHash`,
 * unique-indexed) or looked up against. */
export function hashShareToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type CreateShareResult =
  | { ok: true; shareId: string; rawToken: string }
  | { ok: false; reason: "not_found" | "cap_reached" };

/**
 * Re-validates ownership/READY-status and the active-share cap, then creates the row — all inside
 * one transaction under a `pg_advisory_xact_lock(hashtext(reportJobId))`, the same pattern
 * `createReportJobIfAllowed` (lib/report-jobs.tsx) uses to close the pre-check/create race, except
 * keyed on `reportJobId` (not `userId`) since the cap this guards is per-report, not per-user —
 * locking per-report means concurrent share creation on unrelated reports is never serialized
 * against each other.
 *
 * `userId` is this app's internal User.id, not the Clerk id. The raw token exists only in this
 * function's local scope and the caller's return value — it's generated right before the `create`
 * call and never written anywhere but the response.
 */
export async function createShareIfAllowed(
  userId: string,
  reportJobId: string,
  expiresAt: Date,
): Promise<CreateShareResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reportJobId}))`;

    const reportJob = await tx.reportJob.findFirst({
      where: { id: reportJobId, userId, status: ReportJobStatus.READY },
      select: { id: true },
    });
    if (!reportJob) return { ok: false, reason: "not_found" };

    const activeCount = await tx.reportShare.count({
      where: { reportJobId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (activeCount >= MAX_ACTIVE_SHARES_PER_REPORT) return { ok: false, reason: "cap_reached" };

    const rawToken = mintShareToken();
    const share = await tx.reportShare.create({
      data: { reportJobId, userId, tokenHash: hashShareToken(rawToken), expiresAt },
      select: { id: true },
    });

    return { ok: true, shareId: share.id, rawToken };
  });
}

/**
 * Revokes a share, scoped to `userId` so this doubles as the ownership check (404, never 403, per
 * the repo's IDOR convention — see expenses/[id]/route.ts). Returns whether a row was actually
 * revoked; `false` means either it doesn't exist, isn't owned by this user, or was already
 * revoked — the caller can't distinguish those cases and shouldn't need to.
 */
export async function revokeShare(userId: string, shareId: string): Promise<boolean> {
  const { count } = await db.reportShare.updateMany({
    where: { id: shareId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count > 0;
}

/** Serialized share as returned to the dashboard's Sharing tab. Never includes `tokenHash` — the
 * raw token is shown once at creation and is otherwise unrecoverable, matching ExpenseDto's
 * "never leak internal/sensitive fields" pattern (lib/expenses.ts). */
export type ReportShareDto = {
  id: string;
  reportJobId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  firstViewedAt: Date | null;
};

/** Every share this user owns, newest first — backs the Sharing tab's Active/Expired/Revoked
 * grouping, computed client-side from these fields (no separate status column). */
export async function listSharesForUser(userId: string): Promise<ReportShareDto[]> {
  const shares = await db.reportShare.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      reportJobId: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      firstViewedAt: true,
    },
  });
  return shares;
}

/**
 * Looks up a share by its raw bearer token for the public `/verify/[token]` route and the public
 * download route. Validates `SHARE_TOKEN_PATTERN` *before* hashing/querying — malformed input
 * never touches the DB, closing off a cheap enumeration/DoS vector on the one unauthenticated
 * lookup this app exposes. Includes just the `reportJob`/`user` fields the verify page actually
 * renders (or needs for the first-view email) — deliberately excludes `reportJob.pdfData`, which
 * can be several hundred KB, so every hit on the (rate-limited, but still public) verify page
 * doesn't pull the full PDF bytes out of Postgres just to render a summary. The download route
 * fetches those bytes itself, only once a request actually needs them — see
 * `getReportPdfForShare`.
 */
export async function getShareByToken(rawToken: string) {
  if (!SHARE_TOKEN_PATTERN.test(rawToken)) return null;

  const tokenHash = hashShareToken(rawToken);
  return db.reportShare.findUnique({
    where: { tokenHash },
    include: {
      reportJob: { select: { createdAt: true, platformsParam: true } },
      user: { select: { email: true } },
    },
  });
}

/**
 * Fetches just the PDF bytes + filename for an already-validated share's report — split out from
 * `getShareByToken` so the verify page's render path (every hit) never pulls `pdfData`, only the
 * download route (one click) does. `reportJobId` must already be known-valid (the caller resolved
 * it via `getShareByToken` and checked the share's active/expiry/revocation status first).
 */
export async function getReportPdfForShare(reportJobId: string) {
  return db.reportJob.findUnique({
    where: { id: reportJobId },
    select: { pdfData: true, filename: true },
  });
}

/**
 * Owner-scoped view log for one share — `null` (never an empty array) when the share doesn't
 * exist or isn't owned by `userId`, so the API route can return a 404 rather than an empty-but-
 * real list, matching the rest of the app's ownership-check convention.
 */
export async function getViewsForShare(userId: string, shareId: string) {
  const share = await db.reportShare.findFirst({ where: { id: shareId, userId }, select: { id: true } });
  if (!share) return null;

  return db.reportShareView.findMany({
    where: { reportShareId: shareId },
    orderBy: { viewedAt: "desc" },
  });
}

/**
 * Records a view and atomically claims "first view" status for the email-notification gate.
 * Runs in a transaction, but is race-safe *without* an advisory lock: the `updateMany`'s `WHERE
 * id = shareId AND firstViewedAt IS NULL` clause is itself the lock — under Postgres READ
 * COMMITTED, the first concurrent transaction to reach this statement takes a row lock on that
 * specific `ReportShare` row and commits with `firstViewedAt` now set; any transaction that was
 * blocked behind it re-evaluates the WHERE clause against the now-committed row, finds
 * `firstViewedAt` no longer null, and matches zero rows. Exactly one caller ever sees
 * `isFirstView: true` for a given share, no matter how many /verify views land concurrently.
 */
export async function recordView(
  shareId: string,
  ipHash: string | null,
  userAgent: string | null,
): Promise<{ isFirstView: boolean }> {
  return db.$transaction(async (tx) => {
    await tx.reportShareView.create({
      data: { reportShareId: shareId, ipHash, userAgent },
    });

    const { count } = await tx.reportShare.updateMany({
      where: { id: shareId, firstViewedAt: null },
      data: { firstViewedAt: new Date() },
    });

    return { isFirstView: count === 1 };
  });
}
