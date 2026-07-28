import { describe, it, expect } from "vitest";
import {
  createExpenseSchema,
  updateExpenseSchema,
  listExpensesQuerySchema,
  DEFAULT_PAGE_SIZE,
  MAX_EXPENSE_AMOUNT,
} from "@/lib/expenses";

const VALID = { amount: 19.99, category: "SUPPLIES", date: "2026-07-15" } as const;

describe("createExpenseSchema", () => {
  it("accepts a valid expense and defaults note/deductible to omitted", () => {
    const parsed = createExpenseSchema.parse(VALID);
    expect(parsed).toMatchObject({ amount: 19.99, category: "SUPPLIES", date: "2026-07-15" });
  });

  it("rejects a zero or negative amount", () => {
    expect(createExpenseSchema.safeParse({ ...VALID, amount: 0 }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...VALID, amount: -5 }).success).toBe(false);
  });

  it("rejects more than two decimal places", () => {
    expect(createExpenseSchema.safeParse({ ...VALID, amount: 19.999 }).success).toBe(false);
  });

  it("rejects an amount above the Decimal(10,2) ceiling", () => {
    expect(createExpenseSchema.safeParse({ ...VALID, amount: MAX_EXPENSE_AMOUNT + 1 }).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(createExpenseSchema.safeParse({ ...VALID, category: "GROCERIES" }).success).toBe(false);
  });

  it("rejects a far-future date but allows a past date", () => {
    expect(createExpenseSchema.safeParse({ ...VALID, date: "2999-12-31" }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...VALID, date: "2020-01-01" }).success).toBe(true);
  });

  it("normalizes a blank/whitespace note to null and trims a real note", () => {
    expect(createExpenseSchema.parse({ ...VALID, note: "   " }).note).toBeNull();
    expect(createExpenseSchema.parse({ ...VALID, note: "  gas  " }).note).toBe("gas");
  });
});

describe("updateExpenseSchema", () => {
  it("accepts a partial update", () => {
    expect(updateExpenseSchema.safeParse({ amount: 5 }).success).toBe(true);
    expect(updateExpenseSchema.safeParse({ note: null }).success).toBe(true);
  });

  it("rejects an empty body (nothing to update)", () => {
    expect(updateExpenseSchema.safeParse({}).success).toBe(false);
  });
});

describe("listExpensesQuerySchema", () => {
  it("defaults the limit when absent", () => {
    expect(listExpensesQuerySchema.parse({}).limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it("coerces a string limit and rejects an over-max limit", () => {
    expect(listExpensesQuerySchema.parse({ limit: "5" }).limit).toBe(5);
    expect(listExpensesQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("accepts an optional category and cursor", () => {
    const parsed = listExpensesQuerySchema.parse({ category: "PLATFORM_FEES", cursor: "abc" });
    expect(parsed).toMatchObject({ category: "PLATFORM_FEES", cursor: "abc" });
  });
});
