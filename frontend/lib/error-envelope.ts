/**
 * Isomorphic type guard for the `{ error: { code, message } }` envelope lib/api-error.ts's
 * server-side factories produce (see .claude/skills/api-contracts/SKILL.md). Shared by every
 * client component/hook that needs to surface a real server error message instead of a generic
 * fallback — hooks/use-report-download.ts and app/connect/[slug]/consent/consent-actions.tsx.
 */
export type ErrorEnvelope = { error: { code: string; message: string } };

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const { error } = value as { error: unknown };
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string";
}
