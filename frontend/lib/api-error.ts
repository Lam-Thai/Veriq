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
  badRequest: (message = "Malformed request") =>
    NextResponse.json({ error: { code: "BAD_REQUEST", message } }, { status: 400 }),
  notFound: () => NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 }),
  conflict: (code: string, message: string) => NextResponse.json({ error: { code, message } }, { status: 409 }),
  // 413 per the api-contracts status table. Distinct from `badRequest` so a client can tell "this
  // payload is structurally fine but too big" from "this payload is malformed" — and so a caller
  // that legitimately hit the cap can retry with less rather than debugging its serialization.
  payloadTooLarge: (message = "Request body too large") =>
    NextResponse.json({ error: { code: "PAYLOAD_TOO_LARGE", message } }, { status: 413 }),
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
  // 503, not 500: the request was well-formed and the server is healthy — an optional dependency
  // this one endpoint needs simply isn't configured in this environment (see lib/env.ts's
  // `.optional()` secrets). Distinct from `internal()` so a client can tell "try again later /
  // use another channel" apart from "we broke". The message must stay generic — never name the
  // missing env var, which would be handing an attacker a config map of the deployment.
  serviceUnavailable: (message = "This feature is temporarily unavailable") =>
    NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message } }, { status: 503 }),
  unprocessable: (err: ZodError) =>
    NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Validation failed", fields: err.flatten().fieldErrors } },
      { status: 422 },
    ),
};
