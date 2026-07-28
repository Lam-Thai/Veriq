import "server-only";
import { db } from "@/lib/db";
import type { ExpenseCategory, ExpenseDto } from "@/lib/expenses";
import {
  computeExpenseSummary,
  expenseWindowStart,
  type ExpenseSummary,
  type ExpenseSummaryContext,
} from "@/lib/expense-calculators";

// Shared select — never returns full model rows (see the prisma skill). Amount stays a Decimal
// until serializeExpense converts it, so cents never round-trip through a float in the DB layer.
// Exported so the item route ([id]/route.ts) reuses the exact same field set — one field added to
// Expense can't drift between two copies.
export const EXPENSE_SELECT = {
  id: true,
  amount: true,
  category: true,
  date: true,
  note: true,
  deductible: true,
  createdAt: true,
} as const;

type ExpenseRow = {
  id: string;
  amount: { toNumber: () => number };
  category: ExpenseCategory;
  date: Date;
  note: string | null;
  deductible: boolean;
  createdAt: Date;
};

export function serializeExpense(row: ExpenseRow): ExpenseDto {
  return {
    id: row.id,
    amount: row.amount.toNumber(),
    category: row.category,
    date: row.date.toISOString(),
    note: row.note,
    deductible: row.deductible,
    createdAt: row.createdAt.toISOString(),
  };
}

export type ExpensePage = {
  expenses: ExpenseDto[];
  /** Id to pass as `?cursor=` for the next page, or null when this is the last page. */
  nextCursor: string | null;
};

/**
 * One page of a user's non-deleted expenses, newest expense-date first, keyset-paginated. Always
 * scoped to `userId` (the caller's own internal id) plus `deletedAt: null` — the same IDOR-safe,
 * soft-delete-aware filter every list query in this repo uses. `id` is the tiebreaker in both the
 * ordering and the cursor so pages are stable even when several expenses share a date.
 */
export async function listExpensesForUser(
  userId: string,
  options: { category?: ExpenseCategory | undefined; cursor?: string | undefined; limit: number },
): Promise<ExpensePage> {
  const { category, cursor, limit } = options;

  // Ownership-gate the cursor before handing it to Prisma's keyset pagination. Prisma resolves a
  // cursor row by primary key *before* applying the `where` filter, so a foreign/garbage id would
  // otherwise act as a faint existence oracle (and an unparseable one would 500 at the DB layer).
  // Treating a not-owned cursor as an empty page keeps the endpoint IDOR-tight and stale-client-safe.
  if (cursor) {
    const owned = await db.expense.findFirst({ where: { id: cursor, userId }, select: { id: true } });
    if (!owned) return { expenses: [], nextCursor: null };
  }

  const rows = await db.expense.findMany({
    where: { userId, deletedAt: null, ...(category ? { category } : {}) },
    select: EXPENSE_SELECT,
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: limit + 1, // one extra row is the "is there a next page?" probe
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    expenses: page.map(serializeExpense),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * Rolls a user's trailing-12-month expenses (see EXPENSE_WINDOW_MONTHS) into the summary the
 * Expenses panel renders. The query is date-bounded to that window, so the number of rows summed in
 * JS is naturally capped to about a year of one user's expenses. `context` carries the verified
 * gross income figures (from the income projection) the net-income math needs.
 */
export async function getExpenseSummaryForUser(
  userId: string,
  context: ExpenseSummaryContext,
): Promise<ExpenseSummary> {
  const now = context.now ?? new Date();

  const rows = await db.expense.findMany({
    where: { userId, deletedAt: null, date: { gte: expenseWindowStart(now) } },
    select: { amount: true, category: true, date: true, deductible: true },
    orderBy: { date: "desc" },
  });

  const inputs = rows.map((row) => ({
    amount: row.amount.toNumber(),
    category: row.category,
    date: row.date.toISOString(),
    deductible: row.deductible,
  }));

  return computeExpenseSummary(inputs, { ...context, now });
}
