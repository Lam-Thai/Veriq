import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * Shared error-response factory for app/api/** route handlers. Every failure response uses the
 * { error: { code, message, fields? } } envelope from .claude/skills/api-contracts/SKILL.md so
 * clients can branch on `code` without parsing prose, and so we never leak internals (stack
 * traces, raw DB/Stripe errors) into the response body.
 */
export const ApiError = {
  unauthorized: () =>
    NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, { status: 401 }),
  notFound: () => NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 }),
  conflict: (code: string, message: string) => NextResponse.json({ error: { code, message } }, { status: 409 }),
  // `retryAfterSeconds` should come from the rate limiter's own `resetAt` (see lib/rate-limit.ts)
  // rather than a guess, so the header reflects the caller's actual window, not an arbitrary
  // constant.
  tooManyRequests: (retryAfterSeconds: number) =>
    NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests — try again shortly." } },
      { status: 429, headers: { "Retry-After": String(Math.max(0, retryAfterSeconds)) } },
    ),
  internal: () =>
    NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 }),
  unprocessable: (err: ZodError) =>
    NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Validation failed", fields: err.flatten().fieldErrors } },
      { status: 422 },
    ),
};
