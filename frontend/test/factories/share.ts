import { randomBytes, createHash } from "node:crypto";
import { testDb } from "@/test/helpers/db";

/**
 * Reimplemented, not imported, from lib/report-shares.ts's `mintShareToken`/`hashShareToken`.
 * That module opens with `import "server-only"` (report-shares.ts:1), which throws
 * unconditionally the moment the module is loaded outside Next's webpack build — verified
 * directly (`node -e "require('server-only')"` throws) and documented in
 * frontend/test/helpers/db.ts's top comment, which this file relies on for the same reasoning.
 * Playwright's plain Node test runner never sets the `react-server` export condition Next's
 * bundler uses to no-op that package, so importing report-shares.ts here — even just for these two
 * pure functions — would crash on import before a single test ran.
 *
 * This is a verbatim reimplementation of the same two lines, not a fake or a mock: base64url and
 * sha256-hex are both deterministic, so a token minted/hashed here is byte-for-byte
 * indistinguishable, at the DB layer, from one minted by the real `POST /api/report/shares` route
 * — `getShareByToken`'s `db.reportShare.findUnique({ where: { tokenHash } })` lookup can't tell
 * the difference. Keep this in sync by hand if lib/report-shares.ts's algorithm ever changes —
 * there's no way to share the literal source across the `server-only` boundary without either
 * editing that file (out of scope for this harness) or adding a build step.
 */
function mintShareToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashShareToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Mirrors lib/report-shares.ts's `MAX_SHARE_EXPIRY_DAYS` (90) — see the doc comment above for why
 * this is a hand-kept duplicate rather than an import. Used only to compute this factory's default
 * `expiresAt`; deliberately one day inside the ceiling so a default-constructed share is never
 * accidentally right at (or past, depending on clock skew) the boundary `createShareSchema`
 * validates against. */
const MAX_SHARE_EXPIRY_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CreateTestShareOverrides = {
  /** Defaults to `MAX_SHARE_EXPIRY_DAYS - 1` days from now. Pass a past `Date` to build an expired
   * fixture (e.g. for the `/verify/[token]` "this link has expired" state). */
  expiresAt?: Date;
  /** Defaults to `null` (active). Pass a `Date` to build a revoked fixture. */
  revokedAt?: Date | null;
};

/**
 * Inserts a `ReportShare` row directly for `reportJobId`/`userId`, reusing the real token
 * minting/hashing algorithm above. Returns the raw token — the same thing `POST
 * /api/report/shares` returns once and never persists — so callers can hit `/verify/[rawToken]`
 * or the download route exactly as a real link recipient would.
 */
export async function createTestShare(
  reportJobId: string,
  userId: string,
  overrides: CreateTestShareOverrides = {},
): Promise<{ id: string; rawToken: string }> {
  const rawToken = mintShareToken();
  const defaultExpiresAt = new Date(Date.now() + (MAX_SHARE_EXPIRY_DAYS - 1) * DAY_MS);

  const share = await testDb.reportShare.create({
    data: {
      reportJobId,
      userId,
      tokenHash: hashShareToken(rawToken),
      expiresAt: overrides.expiresAt ?? defaultExpiresAt,
      revokedAt: overrides.revokedAt ?? null,
    },
    select: { id: true },
  });

  return { id: share.id, rawToken };
}
