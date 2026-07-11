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
  internal: () =>
    NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 }),
  unprocessable: (err: ZodError) =>
    NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Validation failed", fields: err.flatten().fieldErrors } },
      { status: 422 },
    ),
};
