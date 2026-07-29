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

/** Mirrors `ReportShareView.userAgent`'s `@db.VarChar(300)` — see recordView. */
const MAX_USER_AGENT_LENGTH = 300;

/**
 * Validates a share-creation request: `reportJobId` must be a real cuid (existence/ownership/
 * READY-status are re-checked server-side in `createShareIfAllowed`, not here — this schema only
 * validates shape), and `expiresAt` must be a real future date within `MAX_SHARE_EXPIRY_DAYS`.
 */
export const createShareSchema = z
  .object({
    // Zod 4 moved string formats to top-level validators; the chained `.cuid()` is deprecated.
    // Matches the `z.url()` usage already in lib/env.ts.
    reportJobId: z.cuid(),
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
    // Explicit top-level `select`, not `include` — `include` returns every scalar on ReportShare,
    // which would put `tokenHash` (the stored credential) and `userId` into an object handled on
    // the app's only unauthenticated code path. Nothing serializes this object today, but listing
    // fields explicitly means a future `NextResponse.json({ data: share })` can't leak either one.
    select: {
      id: true,
      reportJobId: true,
      expiresAt: true,
      revokedAt: true,
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

/** Default/maximum page size for the view log — bounds an unbounded, append-only table. */
export const VIEW_LOG_PAGE_SIZE = 50;

/**
 * Owner-scoped view log for one share — `null` (never an empty array) when the share doesn't
 * exist or isn't owned by `userId`, so the API route can return a 404 rather than an empty-but-
 * real list, matching the rest of the app's ownership-check convention.
 *
 * Keyset-paginated (same shape as lib/expenses.ts): `ReportShareView` is append-only and grows
 * without limit for a widely-circulated link, so returning every row would put an unbounded
 * response on a hot dashboard path. Ordering carries a unique `id` tiebreaker so the cursor is
 * deterministic when several views share a `viewedAt` timestamp. The cursor is not IDOR surface
 * here the way the expenses cursor is: `where` stays pinned to this already-ownership-checked
 * `reportShareId`, so a cursor pointing at another share's row can only shift the window, never
 * return a row from it.
 */
export async function getViewsForShare(
  userId: string,
  shareId: string,
  options: { limit?: number | undefined; cursor?: string | undefined } = {},
) {
  const share = await db.reportShare.findFirst({ where: { id: shareId, userId }, select: { id: true } });
  if (!share) return null;

  // Scope-gate the cursor before handing it to Prisma, mirroring listExpensesForUser: Prisma
  // resolves a cursor row by primary key *before* the `where` filter applies, so a foreign or
  // garbage id would otherwise silently shift the window (or 500 at the DB layer). An unusable
  // cursor is an empty page, never an error.
  if (options.cursor) {
    const owned = await db.reportShareView.findFirst({
      where: { id: options.cursor, reportShareId: shareId },
      select: { id: true },
    });
    if (!owned) return { views: [], nextCursor: null };
  }

  const limit = Math.min(Math.max(options.limit ?? VIEW_LOG_PAGE_SIZE, 1), VIEW_LOG_PAGE_SIZE);

  // take: limit + 1 is a has-more probe — the extra row is sliced off before returning.
  const rows = await db.reportShareView.findMany({
    where: { reportShareId: shareId },
    orderBy: [{ viewedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: { id: true, viewedAt: true, ipHash: true, userAgent: true },
  });

  const hasMore = rows.length > limit;
  const views = hasMore ? rows.slice(0, limit) : rows;
  return { views, nextCursor: hasMore ? (views[views.length - 1]?.id ?? null) : null };
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
      // Truncated to the column's VarChar(300): User-Agent is attacker-controlled and has no
      // protocol length limit, so an over-long header would raise Postgres 22001 and abort the
      // whole transaction — meaning a crafted request could silently suppress its own view being
      // logged. Truncating keeps the record; null stays null (no UA header sent).
      data: { reportShareId: shareId, ipHash, userAgent: userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null },
    });

    const { count } = await tx.reportShare.updateMany({
      where: { id: shareId, firstViewedAt: null },
      data: { firstViewedAt: new Date() },
    });

    return { isFirstView: count === 1 };
  });
}
