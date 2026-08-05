import { describe, expect, it } from "vitest";
import {
  averageMonthlyLoggedExpenses,
  computeAttainmentHistory,
  computeDipAlert,
  computeGoalProgress,
  computeRunway,
} from "@/lib/goal-calculators";
import type { MonthlyAmount } from "@/lib/income-math";

function months(...amounts: number[]): MonthlyAmount[] {
  return amounts.map((amount, index) => ({ month: `M${index + 1}`, amount }));
}

describe("computeGoalProgress", () => {
  it("returns null when there's no usable target or no monthly data", () => {
    expect(computeGoalProgress(0, months(100, 200))).toBeNull();
    expect(computeGoalProgress(-50, months(100, 200))).toBeNull();
    expect(computeGoalProgress(1000, [])).toBeNull();
  });

  it("measures the most recent month against the target", () => {
    const progress = computeGoalProgress(1000, months(400, 800));

    expect(progress?.monthLabel).toBe("M2");
    expect(progress?.monthIncome).toBe(800);
    expect(progress?.attainedFraction).toBeCloseTo(0.8);
    expect(progress?.meterPct).toBeCloseTo(80);
    expect(progress?.remaining).toBe(200);
    expect(progress?.surplus).toBe(0);
    expect(progress?.met).toBe(false);
  });

  it("reports a surplus and clamps the meter once the goal is beaten", () => {
    const progress = computeGoalProgress(1000, months(1500));

    expect(progress?.met).toBe(true);
    expect(progress?.surplus).toBe(500);
    expect(progress?.remaining).toBe(0);
    // The copy can say "150% of goal" while the bar stays inside its track.
    expect(progress?.attainedFraction).toBeCloseTo(1.5);
    expect(progress?.meterPct).toBe(100);
  });

  it("treats hitting the target exactly as met", () => {
    expect(computeGoalProgress(1000, months(1000))?.met).toBe(true);
  });
});

describe("averageMonthlyLoggedExpenses", () => {
  it("averages over months with activity, not the full trailing window", () => {
    // $900 logged across 2 active months is $450/mo — not $75 (900 ÷ 12), which would read as
    // near-zero expenses for someone who only just started logging.
    const average = averageMonthlyLoggedExpenses({
      windowTotal: 900,
      byMonth: [
        { key: "2026-07", label: "Jul 2026", total: 500, deductibleTotal: 0 },
        { key: "2026-06", label: "Jun 2026", total: 400, deductibleTotal: 0 },
      ],
    });

    expect(average).toBe(450);
  });

  it("is 0 when nothing has been logged", () => {
    expect(averageMonthlyLoggedExpenses({ windowTotal: 0, byMonth: [] })).toBe(0);
  });
});

describe("computeRunway", () => {
  it("prefers the user's own expense figure over their logged expenses", () => {
    const runway = computeRunway({
      averageMonthlyIncome: 3000,
      monthlyExpensesOverride: 2000,
      loggedMonthlyExpenses: 500,
      cashOnHand: 6000,
    });

    expect(runway.monthlyExpenses).toBe(2000);
    expect(runway.expensesSource).toBe("override");
    expect(runway.coverageRatio).toBeCloseTo(1.5);
    expect(runway.runwayMonths).toBeCloseTo(3);
  });

  it("falls back to logged expenses when no override is stored", () => {
    const runway = computeRunway({
      averageMonthlyIncome: 3000,
      monthlyExpensesOverride: null,
      loggedMonthlyExpenses: 1500,
      cashOnHand: null,
    });

    expect(runway.monthlyExpenses).toBe(1500);
    expect(runway.expensesSource).toBe("logged");
    expect(runway.coverageRatio).toBeCloseTo(2);
  });

  it("never invents a runway figure when a cash buffer or expense figure is missing", () => {
    const noCash = computeRunway({
      averageMonthlyIncome: 3000,
      monthlyExpensesOverride: 2000,
      loggedMonthlyExpenses: 0,
      cashOnHand: null,
    });
    // Unknown savings must read as "not shown", never as a runway of 0 months.
    expect(noCash.runwayMonths).toBeNull();
    expect(noCash.cashOnHand).toBeNull();

    const noExpenses = computeRunway({
      averageMonthlyIncome: 3000,
      monthlyExpensesOverride: null,
      loggedMonthlyExpenses: 0,
      cashOnHand: 6000,
    });
    expect(noExpenses.expensesSource).toBe("none");
    expect(noExpenses.coverageRatio).toBeNull();
    expect(noExpenses.runwayMonths).toBeNull();
  });

  it("treats a stored $0 expense override as no override, falling back to logged expenses", () => {
    // Only a *positive* override displaces the logged figure — $0 monthly expenses would make the
    // coverage ratio infinite, so it's read as "unset" rather than as a real cost of living.
    const runway = computeRunway({
      averageMonthlyIncome: 3000,
      monthlyExpensesOverride: 0,
      loggedMonthlyExpenses: 1500,
      cashOnHand: 3000,
    });

    expect(runway.monthlyExpenses).toBe(1500);
    expect(runway.expensesSource).toBe("logged");
    expect(runway.runwayMonths).toBeCloseTo(2);
  });

  it("treats a stated $0 buffer as a real answer of zero months", () => {
    const runway = computeRunway({
      averageMonthlyIncome: 3000,
      monthlyExpensesOverride: 2000,
      loggedMonthlyExpenses: 0,
      cashOnHand: 0,
    });

    expect(runway.cashOnHand).toBe(0);
    expect(runway.runwayMonths).toBe(0);
  });
});

describe("computeAttainmentHistory", () => {
  it("marks each month met or missed and counts the hits", () => {
    const history = computeAttainmentHistory(1000, months(800, 1000, 1200));

    expect(history.totalCount).toBe(3);
    expect(history.metCount).toBe(2);
    expect(history.months.map((month) => month.met)).toEqual([false, true, true]);
    expect(history.months[0]?.attainedFraction).toBeCloseTo(0.8);
  });

  it("is empty without a usable target", () => {
    expect(computeAttainmentHistory(0, months(800, 1000))).toEqual({ months: [], metCount: 0, totalCount: 0 });
  });
});

describe("computeDipAlert", () => {
  it("stays silent when the latest month clears the goal and holds its average", () => {
    expect(computeDipAlert(1000, months(1000, 1100, 1200))).toBeNull();
  });

  it("flags a month that came in under the goal", () => {
    const dip = computeDipAlert(1000, months(1000, 900));

    expect(dip?.belowGoal).toBe(true);
    expect(dip?.goalShortfall).toBe(100);
    expect(dip?.monthLabel).toBe("M2");
    // 900 vs a 1000 trailing average is a 10% drop — under the 20% bar, so only the goal branch fired.
    expect(dip?.belowTrailingAverage).toBe(false);
  });

  it("flags a drop of more than 20% below the trailing average even with no goal set", () => {
    const dip = computeDipAlert(null, months(1000, 1000, 700));

    expect(dip?.belowGoal).toBe(false);
    expect(dip?.belowTrailingAverage).toBe(true);
    expect(dip?.trailingAverage).toBe(1000);
    expect(dip?.trailingDropFraction).toBeCloseTo(0.3);
  });

  it("does not fire at exactly the 20% threshold — only past it", () => {
    expect(computeDipAlert(null, months(1000, 1000, 800))).toBeNull();
  });

  it("returns null when there is no monthly data at all", () => {
    expect(computeDipAlert(1000, [])).toBeNull();
  });
});
