import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { ApiError } from "@/lib/api-error";
import { createServiceToken } from "@/lib/service-token";
import { env } from "@/lib/env";
import { loggerFor } from "@/lib/logger";

// Calls out to FastAPI (fetch) — needs Node APIs, never Edge.
export const runtime = "nodejs";

/**
 * Deliberately triggers and captures a test error in both Next.js's and FastAPI's Sentry
 * projects in one call, proving the APM wiring end-to-end — this is also the first real caller
 * of the service-token pattern (lib/service-token.ts -> backend/app/auth.py). Signed-in only,
 * and a 404 (not just unauthenticated) outside development/staging: this must never be
 * reachable, or discoverable, in production.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") return ApiError.notFound();

  const clerkUser = await currentUser();
  if (!clerkUser) return ApiError.unauthorized();

  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  // Prove the FastAPI side captures its own deliberate error too. A failure to even reach it
  // (backend not running locally, etc.) must not stop this route from still exercising the
  // Next.js side below — the two are independent proofs, not a single all-or-nothing check.
  let backendStatus: "captured" | "unreachable" = "unreachable";
  try {
    const token = await createServiceToken(clerkUser.id);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(new URL("/debug/sentry-test", env.FASTAPI_URL), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "x-request-id": requestId },
        signal: controller.signal,
      });
      // The backend route deliberately raises — a 500 here means it worked as intended.
      backendStatus = response.status === 500 ? "captured" : "unreachable";
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    log.warn({ err }, "[debug/sentry-test] could not reach FastAPI debug route");
  }

  const error = new Error("Deliberate Sentry test error triggered via /api/debug/sentry-test");
  Sentry.captureException(error);
  log.error({ err: error, backendStatus }, "[debug/sentry-test] deliberate test error captured");

  return NextResponse.json({ data: { message: "Test error sent to Sentry", backend: backendStatus } });
}
