import type { DashboardStats, MonthlyAmount, UserConnection } from "@/lib/dashboard-data";
import { findPlatformBySlug } from "@/components/landing/platform-data";

// Deterministic, rule-based counterpart to lib/prompts/income-narrative.ts — same descriptive
// shape (narrative + stability/trend + diversification + observations), computed locally with no
// LLM call so the dashboard still has an income summary when the Gemini free tier throttles (see
// components/dashboard/ai-insights-card.tsx). Every value below is derived only from the
// connections/stats already loaded by getUserConnections() / computeDashboardStats() — never a
// credit/lending score, never financial advice, never a number the caller didn't already have.

export type AdvisorStabilityRating = "stable" | "moderate" | "variable";
export type AdvisorTrendDirection = "increasing" | "stable" | "decreasing";

export type AdvisorInsightsOutput = {
  narrative: string;
  stabilityRating: AdvisorStabilityRating;
  trendDirection: AdvisorTrendDirection;
  diversificationSummary: string;
  notableObservations: string[];
};

const STABILITY_COPY: Record<AdvisorStabilityRating, string> = {
  stable: "stable",
  moderate: "moderately variable",
  variable: "variable",
};

const TREND_COPY: Record<AdvisorTrendDirection, string> = {
  increasing: "trending upward",
  stable: "holding steady",
  decreasing: "trending downward",
};

const CURRENCY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function platformName(slug: string): string {
  return findPlatformBySlug(slug)?.name ?? slug;
}

function coefficientOfVariation(amounts: number[]): number {
  if (amounts.length === 0) return 0;
  const mean = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
  if (mean <= 0) return 0;
  const variance = amounts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / amounts.length;
  return Math.sqrt(variance) / mean;
}

const STABILITY_LEVELS: AdvisorStabilityRating[] = ["stable", "moderate", "variable"];

// Thresholds picked against this app's synthetic monthly curve (lib/monthly-bars.ts). Every
// connected platform's monthly amounts are that same fixed set of weights scaled by the
// platform's own total (see distributeAcrossMonths in lib/dashboard-data.ts) and then summed —
// which makes the *shape* of monthlyBreakdown, and therefore its coefficient of variation, always
// exactly the curve's own ~19% cv, regardless of any user's actual amounts. Read in isolation,
// `cv` would land the same connections-independent bucket ("moderate") for every user with any
// verified income, which carries no real per-user signal.
//
// To keep the rating genuinely data-driven, it's blended with how many platforms the income is
// spread across (a real, per-user number from `connections`): income resting on a single source
// is bumped one level riskier, income spread across 3+ sources is bumped one level steadier. This
// is a plain descriptive rule about source concentration, not a statistical or ML model, and it's
// the same "more sources = more resilient" observation notableObservations/diversificationSummary
// already describe — applied here to a coarse rating instead of prose.
function rateStability(monthlyBreakdown: MonthlyAmount[], platformCount: number): AdvisorStabilityRating {
  const cv = coefficientOfVariation(monthlyBreakdown.map((entry) => entry.amount));
  let level = cv < 0.12 ? 0 : cv < 0.22 ? 1 : 2;
  if (platformCount <= 1) level = Math.min(2, level + 1);
  else if (platformCount >= 3) level = Math.max(0, level - 1);
  return STABILITY_LEVELS[level]!;
}

// Same caveat as rateStability's cv: monthlyBreakdown's shape is fixed by the synthetic curve, so
// this reads the curve's own front-half-vs-back-half lift (~27%, always positive under the
// current lib/monthly-bars.ts weights) rather than anything that varies per user today. Kept
// threshold-based (not hardcoded to "increasing") so it stays correct if that curve — the one
// piece of real temporal signal this app has, per distributeAcrossMonths' own rationale — is ever
// rebalanced to a flat or declining shape.
function rateTrend(monthlyBreakdown: MonthlyAmount[]): AdvisorTrendDirection {
  const half = Math.floor(monthlyBreakdown.length / 2);
  if (half === 0) return "stable";

  const average = (entries: MonthlyAmount[]) => entries.reduce((sum, entry) => sum + entry.amount, 0) / entries.length;
  const firstAvg = average(monthlyBreakdown.slice(0, half));
  const secondAvg = average(monthlyBreakdown.slice(monthlyBreakdown.length - half));

  if (firstAvg <= 0) return "stable";
  const change = (secondAvg - firstAvg) / firstAvg;
  if (change > 0.08) return "increasing";
  if (change < -0.08) return "decreasing";
  return "stable";
}

/**
 * Returns `null` for the empty state (no connections, or connections that sum to $0) — callers
 * render an empty state rather than a hollow/zeroed summary, matching AiInsightsCard's behavior.
 */
export function computeAdvisorInsights(
  connections: UserConnection[],
  stats: DashboardStats,
): AdvisorInsightsOutput | null {
  if (connections.length === 0 || stats.totalVerified <= 0) return null;

  const byPlatform = connections
    .map((connection) => ({ name: platformName(connection.slug), amount: connection.verifiedAmount }))
    .filter((platform) => platform.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  if (byPlatform.length === 0) return null;

  const total = stats.totalVerified;
  const top = byPlatform[0]!;
  const topPct = (top.amount / total) * 100;

  const stabilityRating = rateStability(stats.monthlyBreakdown, byPlatform.length);
  const trendDirection = rateTrend(stats.monthlyBreakdown);

  const diversificationSummary =
    byPlatform.length === 1
      ? `All verified income currently comes from a single connected platform, ${top.name}.`
      : `Verified income is spread across ${byPlatform.length} connected platforms, with ${top.name} the largest single source at ${formatPercent(topPct)} of the total.`;

  const notableObservations: string[] = [
    byPlatform.length === 1
      ? `Most income comes from 1 connected platform: ${top.name}.`
      : `Most income comes from ${byPlatform.length} connected platforms.`,
    `Largest single source is ${top.name} at ${formatPercent(topPct)} of verified income.`,
  ];

  if (byPlatform.length > 1) {
    const second = byPlatform[1]!;
    const secondPct = (second.amount / total) * 100;
    notableObservations.push(`Next-largest source is ${second.name} at ${formatPercent(secondPct)} of the total.`);
  }

  notableObservations.push(`Monthly verified income over the period shown is ${TREND_COPY[trendDirection]}.`);

  // Deliberately omits diversificationSummary's sentence — PopulatedState (see
  // advisor-insights-card.tsx) already renders that field as its own paragraph directly below
  // this narrative, so folding it in here would repeat the same sentence twice on screen.
  const narrative = [
    `Verified income across ${byPlatform.length} connected ${byPlatform.length === 1 ? "platform" : "platforms"} totals ${CURRENCY.format(total)} over the period shown.`,
    `Month to month, it looks ${STABILITY_COPY[stabilityRating]} and is ${TREND_COPY[trendDirection]}.`,
  ].join(" ");

  return { narrative, stabilityRating, trendDirection, diversificationSummary, notableObservations };
}
