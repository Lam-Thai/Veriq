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
