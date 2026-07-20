import "server-only";
import { SignJWT } from "jose";
import { env } from "@/lib/env";

const secret = new TextEncoder().encode(env.INTERNAL_JWT_SECRET);

/**
 * Mints a short-lived service token for a Next.js -> FastAPI call, verified by
 * `backend/app/auth.py`'s `verify_service_token`. Payload is `sub` only — no email, no PII, per
 * .claude/skills/security/SKILL.md and the `auth` agent's "Security Rules". 5 minute expiry:
 * long enough for one request, short enough that a leaked token is useless soon after.
 */
export async function createServiceToken(clerkUserId: string): Promise<string> {
  return new SignJWT({ sub: clerkUserId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}
