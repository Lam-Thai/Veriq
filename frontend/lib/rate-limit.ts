import "server-only";

/**
 * In-process, per-key fixed-window rate limiter.
 *
 * SINGLE-INSTANCE ONLY: state lives in a module-scoped Map, so it resets on every redeploy/cold
 * start and does not coordinate across multiple server instances or serverless invocations — a
 * user could get `limit` requests per window *per instance* rather than a true global limit.
 * This repo has no Redis/Upstash instance configured (see .claude/skills/security/SKILL.md's
 * "Repo reality check" — `@upstash/ratelimit` is not installed anywhere), so this is the accepted
 * interim guard against a single user hammering an AI endpoint, not a hard distributed limit.
 * Swap this for `@upstash/ratelimit` once that infra actually exists.
 */
type Bucket = { count: number; windowStartMs: number };

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the Map can't grow unbounded across the process lifetime — cheap
// enough to run inline rather than needing a separate timer.
const MAX_TRACKED_KEYS = 10_000;

// Once `buckets.size` is over the threshold, every call used to trigger a full O(n) scan of every
// bucket — and if most of them are still within their window (not yet expired), that scan doesn't
// shrink the map, so the *next* call scans again, and so on: an O(n) cost on every single call for
// as long as the app stays above the threshold. Throttling the sweep to at most once per interval
// bounds that to O(n) per interval instead, while still reclaiming expired buckets — the removal
// logic itself, and the rate-limit decision below, are unchanged.
const CLEANUP_INTERVAL_MS = 30_000;
let lastCleanupMs = 0;

export type RateLimitResult = { success: boolean; remaining: number; resetAt: number };

/**
 * Returns whether `key` is still within `limit` requests per `windowMs`. Keys should be scoped
 * per feature + per Clerk userId (e.g. `income-insights:${clerkUser.id}`) — never per IP, which
 * is trivially spoofed. `resetAt` (epoch ms) is when the caller's current window ends, so a 429
 * response can carry an accurate `Retry-After`.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_TRACKED_KEYS && now - lastCleanupMs >= CLEANUP_INTERVAL_MS) {
    lastCleanupMs = now;
    for (const [trackedKey, bucket] of buckets) {
      if (now - bucket.windowStartMs >= windowMs) buckets.delete(trackedKey);
    }
  }

  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartMs >= windowMs) {
    buckets.set(key, { count: 1, windowStartMs: now });
    return { success: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  const resetAt = existing.windowStartMs + windowMs;

  if (existing.count >= limit) {
    return { success: false, remaining: 0, resetAt };
  }

  existing.count += 1;
  return { success: true, remaining: limit - existing.count, resetAt };
}
