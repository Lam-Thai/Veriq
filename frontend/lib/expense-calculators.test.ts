import { describe, it, expect } from "vitest";
import {
  computeExpenseSummary,
  expenseWindowStart,
  monthKeyOf,
  monthLabelOf,
  type ExpenseSummaryInput,
} from "@/lib/expense-calculators";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const CONTEXT = { averageMonthlyGross: 4_000, annualizedGross: 48_000, now: NOW };

function expense(overrides: Partial<ExpenseSummaryInput> = {}): ExpenseSummaryInput {
  return { amount: 100, category: "SUPPLIES", date: "2026-07-05T00:00:00.000Z", deductible: true, ...overrides };
}

describe("monthKeyOf / monthLabelOf", () => {
  it("keys on the UTC calendar month", () => {
    expect(monthKeyOf("2026-07-05T00:00:00.000Z")).toBe("2026-07");
  });

  it("labels a month key", () => {
    expect(monthLabelOf("2026-07")).toBe("Jul 2026");
    expect(monthLabelOf("2026-01")).toBe("Jan 2026");
  });
});

describe("expenseWindowStart", () => {
  it("returns the first of the month 11 months before the current month", () => {
    // 12-month trailing window including July 2026 → starts Aug 1 2025.
    expect(expenseWindowStart(NOW).toISOString()).toBe("2025-08-01T00:00:00.000Z");
  });
});

describe("computeExpenseSummary", () => {
  it("returns a zeroed, income-only summary when there are no expenses", () => {
    const summary = computeExpenseSummary([], CONTEXT);
    expect(summary.hasExpenses).toBe(false);
    expect(summary.count).toBe(0);
    expect(summary.thisMonthTotal).toBe(0);
    expect(summary.windowTotal).toBe(0);
    expect(summary.deductibleTotal).toBe(0);
    // Net income with no expenses equals the verified income figures.
    expect(summary.netMonthly).toBe(4_000);
    expect(summary.netAnnualized).toBe(48_000);
    expect(summary.estimatedTaxSavings).toBe(0);
  });

  it("sums this-month, window, and deductible totals and derives net income", () => {
    const expenses: ExpenseSummaryInput[] = [
      expense({ amount: 100, date: "2026-07-05T00:00:00.000Z", deductible: true }),
      expense({ amount: 50.5, category: "OTHER", date: "2026-07-20T00:00:00.000Z", deductible: false }),
      expense({ amount: 200, category: "VEHICLE_MILEAGE", date: "2026-06-10T00:00:00.000Z", deductible: true }),
    ];
    const summary = computeExpenseSummary(expenses, CONTEXT);

    expect(summary.hasExpenses).toBe(true);
    expect(summary.count).toBe(3);
    expect(summary.thisMonthTotal).toBe(150.5);
    expect(summary.windowTotal).toBe(350.5);
    expect(summary.deductibleTotal).toBe(300);
    expect(summary.netMonthly).toBe(3_849.5);
    expect(summary.netAnnualized).toBe(47_649.5);
    // 300 deductible × default 25% rate.
    expect(summary.estimatedTaxSavings).toBe(75);
  });

  it("groups by month, most recent first, with per-month deductible totals", () => {
    const summary = computeExpenseSummary(
      [
        expense({ amount: 100, date: "2026-07-05T00:00:00.000Z", deductible: true }),
        expense({ amount: 50, date: "2026-07-20T00:00:00.000Z", deductible: false }),
        expense({ amount: 200, date: "2026-06-10T00:00:00.000Z", deductible: true }),
      ],
      CONTEXT,
    );
    expect(summary.byMonth.map((m) => m.key)).toEqual(["2026-07", "2026-06"]);
    expect(summary.byMonth[0]).toMatchObject({ label: "Jul 2026", total: 150, deductibleTotal: 100 });
    expect(summary.byMonth[1]).toMatchObject({ label: "Jun 2026", total: 200, deductibleTotal: 200 });
  });

  it("rounds money to whole cents (no floating-point drift)", () => {
    const summary = computeExpenseSummary(
      [expense({ amount: 0.1, deductible: true }), expense({ amount: 0.2, deductible: true })],
      CONTEXT,
    );
    expect(summary.windowTotal).toBe(0.3);
    expect(summary.deductibleTotal).toBe(0.3);
  });

  it("allows a negative net when expenses exceed income (no verified income yet)", () => {
    const summary = computeExpenseSummary([expense({ amount: 120 })], {
      averageMonthlyGross: 0,
      annualizedGross: 0,
      now: NOW,
    });
    expect(summary.netMonthly).toBe(-120);
    expect(summary.netAnnualized).toBe(-120);
  });

  it("honors a custom tax rate for the savings estimate", () => {
    const summary = computeExpenseSummary([expense({ amount: 1_000, deductible: true })], { ...CONTEXT, taxRatePct: 30 });
    expect(summary.estimatedTaxSavings).toBe(300);
  });
});
