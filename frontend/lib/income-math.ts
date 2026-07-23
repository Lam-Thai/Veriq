import { MONTHLY_BARS } from "@/lib/monthly-bars";

/**
 * Pure income-curve math, split out of lib/dashboard-data.ts so it has zero `db`/`env` imports —
 * safe to import directly from a "use client" component (see report-builder.tsx's "estimated
 * qualifying income", recomputed client-side as the user toggles platform checkboxes) without
 * pulling Prisma/server secrets into the client bundle.
 */

export type MonthlyAmount = { month: string; amount: number };

// Normalizes the shared MONTHLY_BARS curve (relative bar heights, e.g. June's 100 = "current,
// full height") into weights that sum to 1, then spreads `total` across those weights. Every
// connected platform's verifiedAmount is distributed with this same curve — this repo has no
// real per-month transaction data (real OAuth is out of scope), so re-deriving a plausible trend
// from the one number we do have (the total) is preferable to inventing a second, disconnected
// fake-data source.
export function distributeAcrossMonths(total: number): MonthlyAmount[] {
  const weightSum = MONTHLY_BARS.reduce((sum, bar) => sum + bar.heightPct, 0);
  return MONTHLY_BARS.map((bar) => ({
    month: bar.month,
    amount: (total * bar.heightPct) / weightSum,
  }));
}

// Normalizes computed monthly amounts into the 0-100 heightPct scale MonthlyBarChart expects
// (tallest month = 100). All-zero months (a brand-new user with no connections) render as flat
// empty bars rather than dividing by zero.
export function toBarHeights(monthlyBreakdown: MonthlyAmount[]): { month: string; heightPct: number }[] {
  const max = Math.max(0, ...monthlyBreakdown.map((entry) => entry.amount));
  return monthlyBreakdown.map((entry) => ({
    month: entry.month,
    heightPct: max > 0 ? (entry.amount / max) * 100 : 0,
  }));
}

// Average monthly amount across the same curve `distributeAcrossMonths` spreads `total` over.
// Used both for the Overview "Average monthly" stat tile (computeDashboardStats) and the report
// builder's "estimated qualifying income" (an average over just the selected platforms' total,
// recomputed client-side).
export function computeAverageMonthly(total: number): number {
  const distribution = distributeAcrossMonths(total);
  return distribution.reduce((sum, entry) => sum + entry.amount, 0) / distribution.length;
}

// Population coefficient of variation (standard deviation / mean) of a set of amounts. Returns 0
// for an empty set or a non-positive mean so callers can treat "no signal" as "perfectly flat"
// rather than dividing by zero. Shared by the advisor insights' stability *rating*
// (lib/advisor-insights.ts) and the Calculators tab's stability *score* (lib/income-calculators.ts)
// so both read variation the same way.
export function coefficientOfVariation(amounts: number[]): number {
  if (amounts.length === 0) return 0;
  const mean = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
  if (mean <= 0) return 0;
  const variance = amounts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / amounts.length;
  return Math.sqrt(variance) / mean;
}

export type MonthlyGrowth = {
  // Change from the second-to-last month to the last month, as a fraction (0.1 = +10%).
  latestPct: number | null;
  // Mean of every consecutive month-over-month change, as a fraction.
  averagePct: number | null;
};

// Month-over-month growth of a monthly-income series. Both figures are null when they can't be
// computed without dividing by a zero/absent prior month (e.g. a brand-new user whose months are
// all $0). Because this app spreads each platform's total over one shared synthetic curve (see
// distributeAcrossMonths — the app has no real per-transaction history), these describe that
// curve's shape, the one temporal signal available, rather than independently varying user data.
export function monthlyGrowth(monthlyBreakdown: MonthlyAmount[]): MonthlyGrowth {
  const amounts = monthlyBreakdown.map((entry) => entry.amount);

  const deltas: number[] = [];
  for (let index = 1; index < amounts.length; index += 1) {
    const previous = amounts[index - 1]!;
    if (previous > 0) deltas.push((amounts[index]! - previous) / previous);
  }

  const previousMonth = amounts.at(-2);
  const latestMonth = amounts.at(-1);
  const latestPct =
    previousMonth !== undefined && latestMonth !== undefined && previousMonth > 0
      ? (latestMonth - previousMonth) / previousMonth
      : null;

  const averagePct = deltas.length > 0 ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null;

  return { latestPct, averagePct };
}
