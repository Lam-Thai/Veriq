import { z } from "zod";
import { ExpenseCategory } from "@/lib/generated/prisma/enums";

/**
 * Shared expense domain: the category value set (with display metadata), the zod schemas the API
 * routes validate against, and the serialized `Expense` DTO the client consumes. Deliberately
 * db-free (`ExpenseCategory` is an erased `import`, only its string values are used at runtime) so
 * both the server routes and the "use client" panel can import it without pulling Prisma/server
 * secrets into the client bundle — same boundary lib/income-calculators.ts holds.
 *
 * Every figure derived from expenses is an informational planning estimate, never a tax filing or
 * professional tax advice — the UI repeats that framing.
 */

// Display order for the category enum (the DB enum itself is unordered). Kept in one place so the
// filter dropdown, the form select, and any labels all agree.
export const EXPENSE_CATEGORIES = [
  ExpenseCategory.VEHICLE_MILEAGE,
  ExpenseCategory.SUPPLIES,
  ExpenseCategory.PLATFORM_FEES,
  ExpenseCategory.PHONE_INTERNET,
  ExpenseCategory.HOME_OFFICE,
  ExpenseCategory.OTHER,
] as const satisfies readonly ExpenseCategory[];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  VEHICLE_MILEAGE: "Vehicle & mileage",
  SUPPLIES: "Supplies",
  PLATFORM_FEES: "Platform fees",
  PHONE_INTERNET: "Phone & internet",
  HOME_OFFICE: "Home office",
  OTHER: "Other",
};

// Decimal(10,2) ceiling — the largest value the column can store. Validated up front so a caller
// never hits a raw DB numeric-overflow error (which would surface as a 500 rather than a 422).
export const MAX_EXPENSE_AMOUNT = 99_999_999.99;
export const MAX_NOTE_LENGTH = 280;
// List page size: clamped so a caller can't request an unbounded page via `?limit=`.
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

// A positive money amount with at most 2 decimal places, within the Decimal(10,2) range. The
// 2-decimal check is float-safe (compares cents, not a raw modulo) so 19.99 passes but 19.999 does
// not.
const amountSchema = z
  .number()
  .refine((n) => Number.isFinite(n), { message: "Amount must be a number" })
  .refine((n) => n > 0, { message: "Amount must be greater than 0" })
  .refine((n) => n <= MAX_EXPENSE_AMOUNT, { message: "Amount is too large" })
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  });

const categorySchema = z.enum(EXPENSE_CATEGORIES);

// A calendar date (YYYY-MM-DD) the expense occurred on. Interpreted at UTC midnight downstream;
// monthly grouping keys on this, not on createdAt. Rejects a date far in the future (a likely
// typo) while allowing today, and anything absurdly old.
const dateSchema = z
  .iso
  .date()
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    if (Number.isNaN(time)) return false;
    const now = new Date();
    // Allow up to (but not including) the start of tomorrow, UTC — an explicit calendar cutoff
    // rather than "now + 24h", which would accept tomorrow's date whenever it's called before
    // midday UTC. Reject dates before 2000.
    const tomorrowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return time >= Date.parse("2000-01-01T00:00:00.000Z") && time < tomorrowUtc;
  }, { message: "Date must be a real date, not in the future" });

// `null` clears the note; omitting it leaves it unchanged (only meaningful on update). Empty/
// whitespace-only strings normalize to `null` so a blank note is never stored as "".
const noteSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().max(MAX_NOTE_LENGTH))
  .transform((value) => (value.length === 0 ? null : value));

export const createExpenseSchema = z.object({
  amount: amountSchema,
  category: categorySchema,
  date: dateSchema,
  note: noteSchema.nullable().optional(),
  deductible: z.boolean().optional(),
});

// Every field optional (a partial update), but the request must change *something* — an empty body
// is a 422, not a silent no-op.
export const updateExpenseSchema = z
  .object({
    amount: amountSchema,
    category: categorySchema,
    date: dateSchema,
    note: noteSchema.nullable(),
    deductible: z.boolean(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update",
  });

export const listExpensesQuerySchema = z.object({
  category: categorySchema.optional(),
  // Keyset cursor: the id of the last row from the previous page.
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

/**
 * Serialized expense as returned by the API and consumed by the client. `amount` is a number (the
 * Decimal is converted server-side via `.toNumber()`), and `date`/`createdAt` are ISO strings so
 * the shape is JSON-serializable across the RSC → client boundary.
 */
export type ExpenseDto = {
  id: string;
  amount: number;
  category: ExpenseCategory;
  date: string;
  note: string | null;
  deductible: boolean;
  createdAt: string;
};

export type { ExpenseCategory };
