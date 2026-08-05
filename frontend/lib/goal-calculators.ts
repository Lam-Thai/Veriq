import type { MonthlyAmount } from "@/lib/income-math";
import type { ExpenseSummary } from "@/lib/expense-calculators";
import { DIP_THRESHOLD_PCT } from "@/lib/goals";

/**
 * Pure calculators behind the dashboard's "Goals" tab. Like lib/income-calculators.ts and
 * lib/expense-calculators.ts, this file has zero `db`/`env` imports (the `MonthlyAmount`/
 * `ExpenseSummary` types are erased `import type`s) so the "use client" panel can import the math
 * directly without pulling Prisma/server secrets into the client bundle.
 *
 * Every figure produced here is an informational planning estimate built from already-verified
 * income plus numbers the user types in. Nothing here is a guarantee, a forecast, a credit score, or
 * financial advice — the UI repeats that framing next to each result.
 *
 * HONESTY CAVEAT (load-bearing, read before extending): this app has no real per-month income
 * history. `monthlyBreakdown` comes from lib/income-math.ts's `distributeAcrossMonths`, which
 * spreads each platform's single verified total across one shared synthetic curve
 * (lib/monthly-bars.ts). Two consequences the copy must never paper over:
 *   1. Per-month figures are an even, modelled distribution of verified totals — not what the user
 *      actually earned in March.
 *   2. That curve rises monotonically, so `computeDipAlert`'s trailing-average branch cannot fire on
 *      today's data. The logic is written against the real shape a genuine monthly feed will have;
 *      it is not a claim that dips are being detected from live earnings today.
 */

// Sum/round to whole cents so float noise never leaks into a displayed money figure — same guard
// lib/expense-calculators.ts uses.
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Current-month progress toward the goal
// ---------------------------------------------------------------------------

export type GoalProgress = {
  /** The goal amount the progress is measured against. */
  target: number;
  /** Label of the most recent month in the verified breakdown, e.g. "Jun". */
  monthLabel: string;
  /** Verified income attributed to that month. */
  monthIncome: number;
  /** Fill fraction for the meter, 0–100 (clamped — an overshoot still shows a full bar). */
  meterPct: number;
  /** Uncapped share of the target as a fraction: 1.12 = 112% of goal. */
  attainedFraction: number;
  /** Amount still needed to reach the goal; 0 once met. */
  remaining: number;
  /** Amount past the goal; 0 until met. */
  surplus: number;
  met: boolean;
};

/**
 * Measures the most recent verified month against the goal. Returns `null` when there's no usable
 * target (a non-positive goal can't be a denominator) or no monthly data at all — callers render an
 * empty state rather than a zeroed-out one, matching how the Calculators cards behave.
 */
export function computeGoalProgress(target: number, monthlyBreakdown: MonthlyAmount[]): GoalProgress | null {
  const latest = monthlyBreakdown.at(-1);
  if (target <= 0 || !latest) return null;

  const monthIncome = Math.max(0, latest.amount);
  const attainedFraction = monthIncome / target;

  return {
    target: round2(target),
    monthLabel: latest.month,
    monthIncome: round2(monthIncome),
    meterPct: Math.min(100, Math.max(0, attainedFraction * 100)),
    attainedFraction,
    remaining: round2(Math.max(0, target - monthIncome)),
    surplus: round2(Math.max(0, monthIncome - target)),
    met: monthIncome >= target,
  };
}

// ---------------------------------------------------------------------------
// Runway / expense coverage
// ---------------------------------------------------------------------------

/** Where the monthly-expenses figure in a runway estimate came from — drives the UI's caption. */
export type ExpensesSource = "override" | "logged" | "none";

export type RunwayEstimate = {
  /** The monthly expense figure actually used. */
  monthlyExpenses: number;
  expensesSource: ExpensesSource;
  /** Average monthly verified income (the Overview tab's "Average monthly"). */
  averageMonthlyIncome: number;
  /**
   * Income ÷ expenses. A *coverage* multiple ("income covers 1.4× your monthly costs"), NOT months
   * of runway — the UI must not conflate the two. Null when expenses are 0 (nothing to divide by).
   */
  coverageRatio: number | null;
  /** User's stated cash buffer, or null when they haven't entered one. */
  cashOnHand: number | null;
  /**
   * True runway: cash ÷ monthly expenses, in months. Null whenever either input is missing or
   * expenses are 0 — never a fabricated 0, which would read as "you're broke".
   */
  runwayMonths: number | null;
};

/**
 * Average monthly expenses from the user's own logged expenses, averaged over the months that
 * actually have activity rather than the full trailing window — a user who started logging last
 * month shouldn't have their expenses divided by 12 and read as near-zero.
 */
export function averageMonthlyLoggedExpenses(summary: Pick<ExpenseSummary, "windowTotal" | "byMonth">): number {
  const monthsWithActivity = summary.byMonth.length;
  if (monthsWithActivity === 0) return 0;
  return round2(summary.windowTotal / monthsWithActivity);
}

export type RunwayInput = {
  averageMonthlyIncome: number;
  /** The user's explicit monthly-expenses override from their goal, or null to use logged expenses. */
  monthlyExpensesOverride: number | null;
  /** Fallback derived from logged expenses (see averageMonthlyLoggedExpenses). */
  loggedMonthlyExpenses: number;
  cashOnHand: number | null;
};

/**
 * Turns verified income plus the user's expense/cash inputs into an expense-coverage multiple and,
 * when a cash buffer is known, a runway in months. Both are arithmetic on numbers the user supplied
 * — no forecasting, no assumption that next month resembles this one.
 */
export function computeRunway(input: RunwayInput): RunwayEstimate {
  const { monthlyExpensesOverride, loggedMonthlyExpenses, cashOnHand } = input;

  const hasOverride = monthlyExpensesOverride !== null && monthlyExpensesOverride > 0;
  const hasLogged = loggedMonthlyExpenses > 0;

  const monthlyExpenses = hasOverride ? monthlyExpensesOverride : hasLogged ? loggedMonthlyExpenses : 0;
  const expensesSource: ExpensesSource = hasOverride ? "override" : hasLogged ? "logged" : "none";

  const averageMonthlyIncome = Math.max(0, input.averageMonthlyIncome);
  const buffer = cashOnHand !== null && cashOnHand >= 0 ? round2(cashOnHand) : null;

  return {
    monthlyExpenses: round2(monthlyExpenses),
    expensesSource,
    averageMonthlyIncome: round2(averageMonthlyIncome),
    coverageRatio: monthlyExpenses > 0 ? averageMonthlyIncome / monthlyExpenses : null,
    cashOnHand: buffer,
    runwayMonths: buffer !== null && monthlyExpenses > 0 ? buffer / monthlyExpenses : null,
  };
}

// ---------------------------------------------------------------------------
// Historical attainment (met / missed per month)
// ---------------------------------------------------------------------------

export type MonthAttainment = {
  month: string;
  amount: number;
  met: boolean;
  /** Share of the target as a fraction: 0.8 = 80% of goal that month. */
  attainedFraction: number;
};

export type AttainmentHistory = {
  months: MonthAttainment[];
  metCount: number;
  totalCount: number;
};

/**
 * Replays the goal against every month in the verified breakdown. Empty (`totalCount: 0`) when
 * there's no usable target — the caller renders the "set a goal" invitation instead.
 *
 * Read the file-header caveat: these months are a modelled distribution of verified totals, so this
 * is "how your verified income maps onto your goal", not a record of what hit the user's bank
 * account. The panel's copy says exactly that.
 */
export function computeAttainmentHistory(target: number, monthlyBreakdown: MonthlyAmount[]): AttainmentHistory {
  if (target <= 0) return { months: [], metCount: 0, totalCount: 0 };

  const months: MonthAttainment[] = monthlyBreakdown.map((entry) => {
    const amount = round2(Math.max(0, entry.amount));
    return {
      month: entry.month,
      amount,
      met: amount >= target,
      attainedFraction: amount / target,
    };
  });

  return {
    months,
    metCount: months.filter((month) => month.met).length,
    totalCount: months.length,
  };
}

// ---------------------------------------------------------------------------
// In-app income-dip alert
// ---------------------------------------------------------------------------

export type DipAlert = {
  /** Label of the month that dipped. */
  monthLabel: string;
  monthIncome: number;
  /** The latest month came in under the user's goal. */
  belowGoal: boolean;
  /** How far under the goal, in dollars; 0 when not below (or no goal set). */
  goalShortfall: number;
  /** The latest month came in more than DIP_THRESHOLD_PCT under the trailing average. */
  belowTrailingAverage: boolean;
  /** Mean of every month *before* the latest one; 0 when not computable. */
  trailingAverage: number;
  /** How far under the trailing average, as a fraction (0.25 = 25% below); 0 when not below. */
  trailingDropFraction: number;
};

/**
 * Raises an in-app alert when the latest verified month falls below the user's goal, or more than
 * DIP_THRESHOLD_PCT below the average of the months preceding it. Returns `null` when neither
 * condition holds — there is no "everything is fine" alert object to render around.
 *
 * `target` may be null (a user can get dip alerts without having set a goal). The trailing-average
 * branch needs at least one prior month with a positive average; see the file-header caveat about
 * why it can't fire on today's synthetic curve.
 */
export function computeDipAlert(target: number | null, monthlyBreakdown: MonthlyAmount[]): DipAlert | null {
  const latest = monthlyBreakdown.at(-1);
  if (!latest) return null;

  const monthIncome = Math.max(0, latest.amount);
  const priorMonths = monthlyBreakdown.slice(0, -1).map((entry) => Math.max(0, entry.amount));
  const trailingAverage =
    priorMonths.length > 0 ? priorMonths.reduce((sum, amount) => sum + amount, 0) / priorMonths.length : 0;

  const belowGoal = target !== null && target > 0 && monthIncome < target;
  const trailingDropFraction = trailingAverage > 0 ? Math.max(0, (trailingAverage - monthIncome) / trailingAverage) : 0;
  const belowTrailingAverage = trailingAverage > 0 && trailingDropFraction > DIP_THRESHOLD_PCT / 100;

  if (!belowGoal && !belowTrailingAverage) return null;

  return {
    monthLabel: latest.month,
    monthIncome: round2(monthIncome),
    belowGoal,
    goalShortfall: belowGoal && target !== null ? round2(target - monthIncome) : 0,
    belowTrailingAverage,
    trailingAverage: round2(trailingAverage),
    trailingDropFraction: belowTrailingAverage ? trailingDropFraction : 0,
  };
}
