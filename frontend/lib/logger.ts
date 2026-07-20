import "server-only";
import pino from "pino";

/**
 * Structured JSON logger for server-side code (route handlers, lib/* services) — replaces ad hoc
 * console.error/warn/log per .claude/skills/error-handling/SKILL.md. `redact` guards against a
 * caller accidentally logging a bearer token or auth header in a passed-in object; it doesn't
 * replace scoping what you log in the first place (never log full request bodies, PII, or raw
 * income figures — see the same skill's "Log rules").
 */
export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: ["token", "authorization", "headers.authorization", "*.token", "*.authorization"],
    remove: true,
  },
});

/** Per-request child logger carrying the correlation id stamped by proxy.ts (`x-request-id`). */
export function loggerFor(requestId: string) {
  return logger.child({ requestId });
}
