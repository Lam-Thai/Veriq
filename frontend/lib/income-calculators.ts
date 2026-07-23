import type { DashboardStats, UserConnection } from "@/lib/dashboard-data";
import { coefficientOfVariation, monthlyGrowth } from "@/lib/income-math";
import { findPlatformBySlug } from "@/components/landing/platform-data";

/**
 * Pure calculators behind the dashboard's "Calculators" tab. Like lib/income-math.ts, this file
 * has zero `db`/`env` imports (the `UserConnection`/`DashboardStats` types are erased `import
 * type`s) so the interactive client cards — components/dashboard/tax-estimator-card.tsx and
 * affordability-card.tsx — can import the math directly without pulling Prisma/server secrets into
 * the client bundle.
 *
 * Every figure produced here is an informational estimate derived only from already-verified
 * income (plus, for the two interactive calculators, numbers the user types in). Nothing here is a
 * credit score, an approval, a tax filing, or a lending decision — the same boundary
 * lib/advisor-insights.ts and components/dashboard/report-builder.tsx already hold. The UI repeats
 * that framing next to each result.
 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function platformName(slug: string): string {
  return findPlatformBySlug(slug)?.name ?? slug;
}

/**
 * Parses a user-typed field into a non-negative number, treating blank/invalid/negative input as
 * 0. The interactive cards hold their inputs as raw strings (so a field can be cleared mid-edit)
 * and run them through this before calculating.
 */
export function parseNonNegativeAmount(input: string): number {
  const parsed = Number.parseFloat(input);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

// ---------------------------------------------------------------------------
// Feature A — annualized projection & growth (derived, no user input)
// ---------------------------------------------------------------------------

export type PlatformContribution = {
  name: string;
  amount: number;
  /** Percent of total verified income, 0–100. */
  sharePct: number;
};

export type IncomeProjection = {
  /** Average monthly verified income (the Overview tab's "Average monthly" figure). */
  averageMonthly: number;
  /** Average monthly × 12 — a full-year run-rate implied by the verified window. */
  annualizedIncome: number;
  /** Latest month-over-month change as a fraction (0.1 = +10%); null when not computable. */
  latestMonthGrowthPct: number | null;
  /** Mean month-over-month change across the window, as a fraction; null when not computable. */
  averageMonthlyGrowthPct: number | null;
  /** Per-platform contribution to verified income, largest first. */
  contributions: PlatformContribution[];
};

/**
 * Annualizes the verified monthly average and summarizes month-over-month movement and per-source
 * contribution. Returns `null` for the empty state (no verified income yet), matching how the
 * advisor/AI insight cards render an empty state rather than a zeroed-out one.
 */
export function computeIncomeProjection(
  stats: DashboardStats,
  connections: UserConnection[],
): IncomeProjection | null {
  if (stats.totalVerified <= 0) return null;

  const { latestPct, averagePct } = monthlyGrowth(stats.monthlyBreakdown);

  const contributions: PlatformContribution[] = connections
    .map((connection) => ({ name: platformName(connection.slug), amount: connection.verifiedAmount }))
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map((entry) => ({ ...entry, sharePct: (entry.amount / stats.totalVerified) * 100 }));

  return {
    averageMonthly: stats.averageMonthly,
    annualizedIncome: stats.averageMonthly * 12,
    latestMonthGrowthPct: latestPct,
    averageMonthlyGrowthPct: averagePct,
    contributions,
  };
}

// ---------------------------------------------------------------------------
// Feature B — income stability score (derived, no user input)
// ---------------------------------------------------------------------------

export type StabilityBand = "strong" | "solid" | "moderate" | "developing";

export type IncomeStabilityScore = {
  /** Overall 0–100 score. */
  score: number;
  band: StabilityBand;
  /** 0–100 subscore: how flat month-to-month income is. */
  consistency: number;
  /** 0–100 subscore: how spread across sources income is. */
  diversification: number;
  /** 0–100 subscore: whether income is rising, flat, or falling. */
  trend: number;
};

function stabilityBand(score: number): StabilityBand {
  if (score >= 80) return "strong";
  if (score >= 60) return "solid";
  if (score >= 40) return "moderate";
  return "developing";
}

/**
 * A descriptive 0–100 stability score, blending three subscores. This extends
 * lib/advisor-insights.ts's coarse stable/moderate/variable *rating* into a number, and inherits
 * the same caveat: month-to-month variation (`consistency`) is fixed by this app's shared synthetic
 * curve (see distributeAcrossMonths), so it carries little per-user signal and is deliberately the
 * lowest-weighted input. `diversification` — computed from the real per-user source mix — is the
 * genuinely per-user driver and is weighted highest. This is a plain descriptive rollup, not a
 * statistical/ML model and never a credit score. Returns `null` for the empty state.
 */
export function computeStabilityScore(
  stats: DashboardStats,
  connections: UserConnection[],
): IncomeStabilityScore | null {
  const sources = connections.filter((connection) => connection.verifiedAmount > 0);
  if (stats.totalVerified <= 0 || sources.length === 0) return null;

  // Consistency: lower coefficient of variation → higher score. cv 0 → 100, cv 0.5 → 0.
  const cv = coefficientOfVariation(stats.monthlyBreakdown.map((entry) => entry.amount));
  const consistency = clamp(100 - cv * 200, 0, 100);

  // Diversification: 1 − HHI (Herfindahl index) of source shares. A single source → 0; many even
  // sources → approaches 100. This is the real, per-user input.
  const herfindahl = sources.reduce((sum, connection) => {
    const share = connection.verifiedAmount / stats.totalVerified;
    return sum + share * share;
  }, 0);
  const diversification = clamp((1 - herfindahl) * 100, 0, 100);

  // Trend: rising income scores highest, flat mid, falling lowest — descriptive only.
  const { averagePct } = monthlyGrowth(stats.monthlyBreakdown);
  const trend = averagePct === null ? 60 : averagePct > 0.02 ? 100 : averagePct < -0.02 ? 40 : 70;

  const score = Math.round(0.3 * consistency + 0.45 * diversification + 0.25 * trend);

  return {
    score,
    band: stabilityBand(score),
    consistency: Math.round(consistency),
    diversification: Math.round(diversification),
    trend: Math.round(trend),
  };
}

// ---------------------------------------------------------------------------
// Feature C — tax set-aside estimator (interactive: effective rate %)
// ---------------------------------------------------------------------------

export const DEFAULT_TAX_RATE_PCT = 25;
export const MIN_TAX_RATE_PCT = 0;
export const MAX_TAX_RATE_PCT = 60;

export type TaxSetAside = {
  /** The effective rate actually applied, after clamping to [MIN, MAX]. */
  ratePct: number;
  annualIncome: number;
  annualSetAside: number;
  monthlySetAside: number;
  /** Quarterly figure — aligns with the US quarterly estimated-tax cadence gig workers file on. */
  quarterlySetAside: number;
  afterTaxMonthly: number;
};

/**
 * Estimates how much of verified income to set aside for self-employment/income taxes at a
 * user-chosen effective rate. A planning rule of thumb (many gig workers set aside ~25–30%), not
 * tax advice, a tax filing, or a substitute for a professional — the UI says so.
 */
export function computeTaxSetAside(annualIncome: number, ratePct: number): TaxSetAside {
  const rate = clamp(ratePct, MIN_TAX_RATE_PCT, MAX_TAX_RATE_PCT);
  const safeAnnualIncome = Math.max(0, annualIncome);
  const annualSetAside = safeAnnualIncome * (rate / 100);

  return {
    ratePct: rate,
    annualIncome: safeAnnualIncome,
    annualSetAside,
    monthlySetAside: annualSetAside / 12,
    quarterlySetAside: annualSetAside / 4,
    afterTaxMonthly: safeAnnualIncome / 12 - annualSetAside / 12,
  };
}

// ---------------------------------------------------------------------------
// Feature D — affordability & debt-to-income (interactive: debts, housing)
// ---------------------------------------------------------------------------

/** Conventional "comfortable" back-end DTI ceiling many lenders reference. */
export const DTI_BACK_END_THRESHOLD = 0.36;
/** Common landlord rule that gross monthly income should be at least 3× the rent. */
export const RENT_INCOME_MULTIPLE = 3;

export type DtiBand = "healthy" | "moderate" | "elevated" | "high";

export type Affordability = {
  monthlyIncome: number;
  monthlyDebt: number;
  monthlyHousing: number;
  /** (debt + housing) / income as a fraction; null when income is 0 (can't divide). */
  dtiRatio: number | null;
  dtiBand: DtiBand | null;
  /** Rent that keeps income at the RENT_INCOME_MULTIPLE (income ÷ 3). */
  maxRentByIncomeRule: number;
  /** Housing payment that keeps back-end DTI at the threshold, given current debts (≥ 0). */
  maxHousingPaymentAtThreshold: number;
};

function dtiBand(ratio: number): DtiBand {
  if (ratio < 0.36) return "healthy";
  if (ratio < 0.43) return "moderate";
  if (ratio < 0.5) return "elevated";
  return "high";
}

/**
 * Turns verified monthly income plus user-entered debt and (optional) planned housing into a
 * debt-to-income ratio and two affordability reference points. Every threshold here (36% back-end
 * DTI, 3× rent) is a widely-cited rule of thumb, surfaced for the user's own planning — never a
 * pre-qualification, approval, or lending decision, which the UI states plainly.
 */
export function computeAffordability(
  monthlyIncome: number,
  monthlyDebt: number,
  monthlyHousing: number,
): Affordability {
  const income = Math.max(0, monthlyIncome);
  const debt = Math.max(0, monthlyDebt);
  const housing = Math.max(0, monthlyHousing);
  const ratio = income > 0 ? (debt + housing) / income : null;

  return {
    monthlyIncome: income,
    monthlyDebt: debt,
    monthlyHousing: housing,
    dtiRatio: ratio,
    dtiBand: ratio === null ? null : dtiBand(ratio),
    maxRentByIncomeRule: income / RENT_INCOME_MULTIPLE,
    maxHousingPaymentAtThreshold: Math.max(0, income * DTI_BACK_END_THRESHOLD - debt),
  };
}
