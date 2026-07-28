import type { ExpenseCategory } from "@/lib/expenses";
import { DEFAULT_TAX_RATE_PCT } from "@/lib/income-calculators";

/**
 * Pure aggregation behind the dashboard's "Expenses" tab. Like lib/income-calculators.ts, this has
 * zero `db`/`env` imports so both the server data layer and the "use client" panel can import it
 * directly. It turns a user's tracked expenses (plus their verified *gross* income figures) into
 * monthly totals, net (after-expense) income, and an estimated deductible total.
 *
 * Every figure here is an informational planning estimate — never a tax filing, a deduction the IRS
 * has accepted, or professional tax advice. The UI repeats that framing.
 */

/** Number of trailing months (including the current one) the annualized figures are built from. */
export const EXPENSE_WINDOW_MONTHS = 12;

// Sum/round to whole cents so float noise (0.1 + 0.2) never leaks into a displayed money figure.
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "2026-07-15T00:00:00.000Z" → "2026-07". Keys on the UTC calendar month, matching how `date` is
 * stored (UTC midnight). */
export function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

const MONTH_LABEL_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-07" → "Jul 2026". */
export function monthLabelOf(monthKey: string): string {
  const parsed = Date.parse(`${monthKey}-01T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return monthKey;
  return MONTH_LABEL_FMT.format(new Date(parsed));
}

/**
 * Start (UTC midnight, first of the month) of the trailing `EXPENSE_WINDOW_MONTHS` window relative
 * to `now`. The server scopes its summary query with `date >= this` so the row count aggregated is
 * naturally bounded to a year of a single user's expenses.
 */
export function expenseWindowStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (EXPENSE_WINDOW_MONTHS - 1), 1, 0, 0, 0, 0));
}

/** The minimal expense shape the aggregation needs — a subset of ExpenseDto. */
export type ExpenseSummaryInput = {
  amount: number;
  category: ExpenseCategory;
  date: string;
  deductible: boolean;
};

export type ExpenseMonthTotal = {
  /** "YYYY-MM" — stable sort/identity key. */
  key: string;
  /** "Jul 2026" — display label. */
  label: string;
  total: number;
  deductibleTotal: number;
};

export type ExpenseSummary = {
  /** Whether the user has any expenses in the window (drives empty vs populated state). */
  hasExpenses: boolean;
  /** Count of expenses aggregated (within the trailing window). */
  count: number;
  /** Sum of expenses dated within the current UTC calendar month. */
  thisMonthTotal: number;
  /** Per-month totals across the trailing window, most recent first (only months with activity). */
  byMonth: ExpenseMonthTotal[];
  /** Sum of all expenses in the trailing window (the annualized expense figure). */
  windowTotal: number;
  /** Sum of the deductible expenses in the trailing window. */
  deductibleTotal: number;
  /** Verified average monthly gross income (echoed from context, for display). */
  averageMonthlyGross: number;
  /** Verified annualized gross income (echoed from context, for display). */
  annualizedGross: number;
  /** Average monthly gross − this month's expenses. Can be negative (expenses exceeded income). */
  netMonthly: number;
  /** Annualized gross − trailing-window expenses. Can be negative. */
  netAnnualized: number;
  /** Effective rate applied to estimate the tax savings from deductions. */
  taxRatePct: number;
  /** Estimated tax reduction from deductible expenses: deductibleTotal × rate. Informational only. */
  estimatedTaxSavings: number;
};

export type ExpenseSummaryContext = {
  /** Verified average monthly gross income (from the income projection). */
  averageMonthlyGross: number;
  /** Verified annualized gross income (from the income projection). */
  annualizedGross: number;
  /** Effective tax rate (%) used only to estimate savings from deductions. Defaults to the same
   *  rule-of-thumb rate the Tax set-aside card starts at. */
  taxRatePct?: number;
  /** Injectable clock so the "current month" boundary is deterministic in tests. */
  now?: Date;
};

/**
 * Rolls a user's trailing-window expenses up into the figures the Expenses panel renders. `expenses`
 * is expected to already be scoped to the trailing window (see `expenseWindowStart`) and to exclude
 * soft-deleted rows — this function does not re-filter by date, it only groups and sums.
 */
export function computeExpenseSummary(
  expenses: ExpenseSummaryInput[],
  context: ExpenseSummaryContext,
): ExpenseSummary {
  const now = context.now ?? new Date();
  const taxRatePct = context.taxRatePct ?? DEFAULT_TAX_RATE_PCT;
  const averageMonthlyGross = Math.max(0, context.averageMonthlyGross);
  const annualizedGross = Math.max(0, context.annualizedGross);

  const currentMonthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const monthMap = new Map<string, { total: number; deductibleTotal: number }>();
  let windowTotal = 0;
  let deductibleTotal = 0;
  let thisMonthTotal = 0;

  for (const expense of expenses) {
    const key = monthKeyOf(expense.date);
    const bucket = monthMap.get(key) ?? { total: 0, deductibleTotal: 0 };
    bucket.total += expense.amount;
    if (expense.deductible) bucket.deductibleTotal += expense.amount;
    monthMap.set(key, bucket);

    windowTotal += expense.amount;
    if (expense.deductible) deductibleTotal += expense.amount;
    if (key === currentMonthKey) thisMonthTotal += expense.amount;
  }

  const byMonth: ExpenseMonthTotal[] = [...monthMap.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, value]) => ({
      key,
      label: monthLabelOf(key),
      total: round2(value.total),
      deductibleTotal: round2(value.deductibleTotal),
    }));

  windowTotal = round2(windowTotal);
  deductibleTotal = round2(deductibleTotal);
  thisMonthTotal = round2(thisMonthTotal);

  return {
    hasExpenses: expenses.length > 0,
    count: expenses.length,
    thisMonthTotal,
    byMonth,
    windowTotal,
    deductibleTotal,
    averageMonthlyGross: round2(averageMonthlyGross),
    annualizedGross: round2(annualizedGross),
    netMonthly: round2(averageMonthlyGross - thisMonthTotal),
    netAnnualized: round2(annualizedGross - windowTotal),
    taxRatePct,
    estimatedTaxSavings: round2(deductibleTotal * (taxRatePct / 100)),
  };
}
