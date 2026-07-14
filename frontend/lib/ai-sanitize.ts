/**
 * Sanitizes a string before it is embedded in any AI prompt. Every string pulled from the
 * database (a platform slug/display name, a month label, etc.) goes through this — even though
 * today's platform names come from a fixed internal allowlist (see
 * components/landing/platform-data.ts) rather than free-form user input — because that boundary
 * is not this function's job to assume; treat every DB-sourced string as untrusted before it
 * gets anywhere near a prompt, per .claude/skills/ai-integration/SKILL.md.
 *
 * - Strips null bytes (defends against injected control characters).
 * - Strips HTML/XML-like tags (defends against markup smuggled into a rendered narrative).
 * - Trims surrounding whitespace.
 * - Caps length so one field can't blow the prompt token budget.
 */
export function sanitizeAIInput(raw: string, maxLength = 4000): string {
  return raw
    .replace(/\x00/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, maxLength);
}
