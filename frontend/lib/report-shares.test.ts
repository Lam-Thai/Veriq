import { describe, it, expect, vi, beforeEach } from "vitest";

// "server-only" throws unconditionally when required outside Next's bundler — see lib/email.test.ts
// for the same note. Every import of lib/report-shares.ts below would otherwise throw immediately.
vi.mock("server-only", () => ({}));

// lib/report-shares.ts unconditionally imports @/lib/db at module scope, and lib/db.ts constructs a
// PrismaClient off lib/env.ts's validated `env` object — which throws outside `next build` unless
// every required var (DATABASE_URL, STRIPE_SECRET_KEY, ...) is set. Rather than populate a full fake
// env just to satisfy an import chain this file doesn't otherwise need, @/lib/db is mocked directly,
// same reasoning lib/email.test.ts documents for mocking @/lib/env instead of populating process.env.
//
// The mocked `$transaction` also doubles as the seam for the recordView race test below: `tx` is a
// small hand-rolled fake (not a new mocking framework) whose `reportShare.updateMany` reproduces the
// exact "WHERE id = ... AND firstViewedAt IS NULL" check-and-set recordView's real implementation
// relies on, so a concurrent-call test genuinely exercises recordView's own race-guard logic rather
// than re-describing it.
const { mockDb } = vi.hoisted(() => {
  const shares = new Map<string, { firstViewedAt: Date | null }>();
  const views: Array<Record<string, unknown>> = [];
  return {
    mockDb: {
      __shares: shares,
      __views: views,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          $executeRaw: vi.fn(async () => undefined),
          reportShareView: {
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
              views.push(data);
              return { id: `view-${views.length}`, ...data };
            }),
          },
          reportShare: {
            updateMany: vi.fn(
              async ({ where, data }: { where: { id: string; firstViewedAt: null }; data: { firstViewedAt: Date } }) => {
                const record = shares.get(where.id);
                if (!record) return { count: 0 };
                // Mirrors the real WHERE clause: only matches (and only then mutates) a row whose
                // firstViewedAt is still null. No await happens before this check-and-set, so two
                // "concurrent" recordView() calls driven through Promise.all can never both observe
                // firstViewedAt === null here — JS only yields at an `await`, and there isn't one in
                // between the check and the write.
                if (record.firstViewedAt !== null) return { count: 0 };
                record.firstViewedAt = data.firstViewedAt;
                return { count: 1 };
              },
            ),
          },
        };
        return fn(tx);
      }),
    },
  };
});
vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  createShareSchema,
  MAX_SHARE_EXPIRY_DAYS,
  mintShareToken,
  hashShareToken,
  SHARE_TOKEN_PATTERN,
  recordView,
} from "@/lib/report-shares";

const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_CUID = "cjld2cjxh0000qzrmn831i7rn";

beforeEach(() => {
  mockDb.__shares.clear();
  mockDb.__views.length = 0;
  mockDb.$transaction.mockClear();
});

describe("createShareSchema", () => {
  it("rejects an expiresAt in the past", () => {
    const result = createShareSchema.safeParse({
      reportJobId: VALID_CUID,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "expiresAt")).toBe(true);
      expect(result.error.issues.some((issue) => /future/i.test(issue.message))).toBe(true);
    }
  });

  it(`rejects an expiresAt more than ${MAX_SHARE_EXPIRY_DAYS} days out`, () => {
    const result = createShareSchema.safeParse({
      reportJobId: VALID_CUID,
      expiresAt: new Date(Date.now() + (MAX_SHARE_EXPIRY_DAYS + 1) * DAY_MS).toISOString(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => /days out/i.test(issue.message))).toBe(true);
    }
  });

  it("accepts a valid near-future expiresAt with a well-formed reportJobId", () => {
    const result = createShareSchema.safeParse({
      reportJobId: VALID_CUID,
      expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed (non-cuid) reportJobId", () => {
    const result = createShareSchema.safeParse({
      reportJobId: "not-a-cuid",
      expiresAt: new Date(Date.now() + DAY_MS).toISOString(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "reportJobId")).toBe(true);
    }
  });
});

describe("SHARE_TOKEN_PATTERN", () => {
  it("matches a real mintShareToken() output", () => {
    expect(SHARE_TOKEN_PATTERN.test(mintShareToken())).toBe(true);
  });

  it("rejects obviously malformed strings", () => {
    expect(SHARE_TOKEN_PATTERN.test("too-short")).toBe(false);
    expect(SHARE_TOKEN_PATTERN.test("a".repeat(43) + "!")).toBe(false); // invalid char, wrong length
    expect(SHARE_TOKEN_PATTERN.test("a".repeat(42) + "/")).toBe(false); // slash isn't in the alphabet
    expect(SHARE_TOKEN_PATTERN.test(`${"a".repeat(43)}?foo=bar`)).toBe(false); // query-string-like tail
    expect(SHARE_TOKEN_PATTERN.test("a".repeat(44))).toBe(false); // one char too long
  });
});

describe("mintShareToken / hashShareToken", () => {
  it("mints a different token on each call (entropy sanity check, not cryptographic proof)", () => {
    expect(mintShareToken()).not.toBe(mintShareToken());
  });

  it("hashes deterministically to a 64-char hex sha256 digest", () => {
    const raw = mintShareToken();
    const first = hashShareToken(raw);
    const second = hashShareToken(raw);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different hashes for different raw tokens", () => {
    expect(hashShareToken(mintShareToken())).not.toBe(hashShareToken(mintShareToken()));
  });
});

describe("recordView — first-view race guard", () => {
  it("under two concurrent calls for the same share, exactly one resolves isFirstView: true", async () => {
    mockDb.__shares.set("share-1", { firstViewedAt: null });

    const [first, second] = await Promise.all([
      recordView("share-1", null, "ua-a"),
      recordView("share-1", null, "ua-b"),
    ]);

    const firstViewFlags = [first.isFirstView, second.isFirstView];
    // Exactly one true, one false — never both true (double-send) and never both false (no email
    // ever sent for a share that genuinely was viewed).
    expect(firstViewFlags.filter(Boolean)).toHaveLength(1);

    // Both views are still recorded regardless of which one "won" the first-view race — recording
    // the view and claiming first-view status are separate concerns.
    expect(mockDb.__views).toHaveLength(2);
  });

  it("returns isFirstView: false for a share that was already viewed", async () => {
    mockDb.__shares.set("share-2", { firstViewedAt: new Date("2026-01-01T00:00:00.000Z") });

    const result = await recordView("share-2", null, "ua-c");

    expect(result.isFirstView).toBe(false);
    expect(mockDb.__views).toHaveLength(1);
  });

  // NOTE on scope: this fake reproduces recordView's own WHERE/count semantics faithfully (see the
  // updateMany fake above), so it genuinely exercises the "first committer wins" branch in
  // lib/report-shares.ts rather than re-describing it in the test. What it can't cover is the actual
  // cross-process guarantee Postgres provides (row-level locking under READ COMMITTED across two
  // real, separate connections) — that requires a live database and is integration-test territory,
  // matching the plan's documented constraint that true concurrency-under-Postgres coverage needs
  // infra this repo's CI doesn't have yet.
});
