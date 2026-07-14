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

export type RateLimitResult = { success: boolean; remaining: number };

/**
 * Returns whether `key` is still within `limit` requests per `windowMs`. Keys should be scoped
 * per feature + per Clerk userId (e.g. `income-insights:${clerkUser.id}`) — never per IP, which
 * is trivially spoofed.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [trackedKey, bucket] of buckets) {
      if (now - bucket.windowStartMs >= windowMs) buckets.delete(trackedKey);
    }
  }

  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartMs >= windowMs) {
    buckets.set(key, { count: 1, windowStartMs: now });
    return { success: true, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return { success: false, remaining: 0 };
  }

  existing.count += 1;
  return { success: true, remaining: limit - existing.count };
}
