import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { ai, AI_MODEL } from "@/lib/ai";
import { sanitizeAIInput } from "@/lib/ai-sanitize";
import { distributeAcrossMonths, getUserConnections, type UserConnection } from "@/lib/dashboard-data";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import {
  INCOME_NARRATIVE_SYSTEM_PROMPT,
  INCOME_NARRATIVE_TOOL,
  INCOME_NARRATIVE_TOOL_NAME,
  IncomeNarrativeOutputSchema,
  type IncomeNarrativeOutput,
} from "@/lib/prompts/income-narrative";

// Staleness rule (documented here, the single place that owns it): a cached IncomeNarrative row
// is reused as-is when BOTH hold, otherwise it is regenerated:
//   1. `inputHash` still matches the user's current connections (nothing changed), AND
//   2. it was generated less than STALE_AFTER_MS ago.
// This keeps the dashboard card and the PDF report from calling Claude on every single page
// load/report download, while still refreshing periodically even if verifiedAmount never changes
// (e.g. if the prompt or model is updated later, a 24h TTL bounds how long a row can go stale).
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours

export type IncomeNarrativeResult =
  | { status: "no_data" }
  | { status: "ok"; data: IncomeNarrativeOutput }
  | { status: "error" };

/**
 * Deterministic fingerprint of the amounts that fed the last generation. Sorted so connection
 * order (which is `orderBy: connectedAt asc` in getUserConnections) never changes the hash —
 * only the actual slug/amount pairs do.
 */
function computeInputHash(connections: UserConnection[]): string {
  const canonical = connections
    .map((connection) => `${connection.slug}:${connection.verifiedAmount.toFixed(2)}`)
    .sort()
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Builds the user-message content sent to Claude. All platform-derived strings are sanitized
 * before interpolation, and the whole block is wrapped in <income_data> tags — the system prompt
 * (lib/prompts/income-narrative.ts) instructs the model to treat everything inside that tag as
 * data to describe, never as instructions.
 */
function buildPromptContent(connections: UserConnection[]): string {
  const totalVerified = connections.reduce((sum, connection) => sum + connection.verifiedAmount, 0);

  const byPlatform = connections
    .map((connection) => ({
      name: sanitizeAIInput(findPlatformBySlug(connection.slug)?.name ?? connection.slug, 200),
      amount: connection.verifiedAmount,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Reuses the exact same synthetic monthly curve the dashboard chart renders (see
  // lib/dashboard-data.ts) — there is no real per-month transaction history in this repo, so the
  // model describes the same fake-but-consistent trend the user already sees on screen, not a
  // second, disconnected fake-data source.
  const monthly = distributeAcrossMonths(totalVerified);

  const platformLines = byPlatform.map((platform) => `- ${platform.name}: $${platform.amount.toFixed(2)}`).join("\n");
  const monthlyLines = monthly
    .map((entry) => `- ${sanitizeAIInput(entry.month, 20)}: $${entry.amount.toFixed(2)}`)
    .join("\n");

  return [
    "<income_data>",
    `Total verified income (synthetic 6-month period): $${totalVerified.toFixed(2)}`,
    "",
    "By platform:",
    platformLines,
    "",
    "Monthly distribution (a synthetic curve derived from the total above, not real per-day",
    "transaction dates):",
    monthlyLines,
    "</income_data>",
  ].join("\n");
}

function toOutput(cached: {
  narrative: string;
  stabilityRating: string;
  trendDirection: string;
  diversificationSummary: string;
  notableObservations: string[];
}): IncomeNarrativeOutput | null {
  const parsed = IncomeNarrativeOutputSchema.safeParse(cached);
  return parsed.success ? parsed.data : null;
}

/**
 * Generates (or reuses a cached) plain-English narrative + structured insight fields describing
 * a signed-in user's verified income. Scoped entirely to the single `clerkId` passed in — it
 * looks up that user's own `User`/`PlatformConnection` rows and nothing else, so there is no way
 * for a caller to widen this to another user's data. Never throws: every failure path (no data,
 * malformed model output, a network/timeout error) returns a typed result instead.
 */
export async function generateIncomeNarrative(clerkId: string): Promise<IncomeNarrativeResult> {
  const startedAt = Date.now();

  const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } });
  if (!user) return { status: "no_data" };

  // getUserConnections re-derives `user` internally, but it's the single source of truth for the
  // UserConnection shape/mapping (see lib/dashboard-data.ts) — reusing it here keeps that mapping
  // from drifting between the dashboard and this service.
  const connections = await getUserConnections(clerkId);
  if (connections.length === 0) return { status: "no_data" };

  const inputHash = computeInputHash(connections);

  const cached = await db.incomeNarrative.findUnique({ where: { userId: user.id } });
  const isFresh = cached !== null && Date.now() - cached.generatedAt.getTime() < STALE_AFTER_MS;

  if (cached && isFresh && cached.inputHash === inputHash) {
    const output = toOutput(cached);
    if (output) return { status: "ok", data: output };
    // Cached row doesn't match the current output schema (e.g. an older prompt version) — fall
    // through and regenerate rather than serving malformed data.
  }

  try {
    const response = await ai.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      system: INCOME_NARRATIVE_SYSTEM_PROMPT,
      tools: [INCOME_NARRATIVE_TOOL],
      tool_choice: { type: "tool", name: INCOME_NARRATIVE_TOOL_NAME },
      messages: [{ role: "user", content: buildPromptContent(connections) }],
    });

    const toolUse = response.content.find(
      (block): block is Extract<(typeof response.content)[number], { type: "tool_use" }> =>
        block.type === "tool_use",
    );
    if (!toolUse) {
      console.error("[income-narrative] no tool_use block in response", {
        userId: user.id,
        durationMs: Date.now() - startedAt,
      });
      return { status: "error" };
    }

    const parsed = IncomeNarrativeOutputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      console.error("[income-narrative] model output failed validation", {
        userId: user.id,
        durationMs: Date.now() - startedAt,
      });
      return { status: "error" };
    }

    const data = parsed.data;
    await db.incomeNarrative.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        narrative: data.narrative,
        stabilityRating: data.stabilityRating,
        trendDirection: data.trendDirection,
        diversificationSummary: data.diversificationSummary,
        notableObservations: data.notableObservations,
        inputHash,
        generatedAt: new Date(),
      },
      update: {
        narrative: data.narrative,
        stabilityRating: data.stabilityRating,
        trendDirection: data.trendDirection,
        diversificationSummary: data.diversificationSummary,
        notableObservations: data.notableObservations,
        inputHash,
        generatedAt: new Date(),
      },
    });

    // Metadata-only — no raw income figures, platform identifiers, or prompt/response content.
    console.log("[income-narrative] generated", {
      userId: user.id,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      durationMs: Date.now() - startedAt,
    });

    return { status: "ok", data };
  } catch (err) {
    console.error("[income-narrative] generation failed", {
      userId: user.id,
      durationMs: Date.now() - startedAt,
      outcome: "error",
    });
    if (process.env.NODE_ENV === "development") console.error(err);
    return { status: "error" };
  }
}
