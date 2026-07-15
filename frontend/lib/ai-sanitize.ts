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
 *   Repeats the tag-strip pass to a fixed point rather than replacing once — a single pass
 *   can leave a tag behind on crafted nested input (e.g. "<<script>script>" strips to
 *   "<script>" after just one pass); looping until nothing changes closes that bypass
 *   (CodeQL js/incomplete-multi-character-sanitization).
 * - Trims surrounding whitespace.
 * - Caps length so one field can't blow the prompt token budget.
 */
export function sanitizeAIInput(raw: string, maxLength = 4000): string {
  let sanitized = raw.replace(/\x00/g, "");

  let previous: string;
  do {
    previous = sanitized;
    sanitized = sanitized.replace(/<[^>]*>/g, "");
  } while (sanitized !== previous);

  return sanitized.trim().slice(0, maxLength);
}
