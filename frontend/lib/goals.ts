import { z } from "zod";
import { IncomeGoalType } from "@/lib/generated/prisma/enums";

/**
 * Shared goals domain: the goal-type value set (with display metadata), the zod schemas the API
 * routes validate against, and the serialized `IncomeGoal` DTO the client consumes. Deliberately
 * db-free (`IncomeGoalType` is an erased `import`, only its string values are used at runtime) so
 * both the server routes and the "use client" panel can import it without pulling Prisma/server
 * secrets into the client bundle — the same boundary lib/expenses.ts holds.
 *
 * Every figure derived from a goal is an informational planning estimate, never a guarantee, an
 * approval, or financial advice — the UI repeats that framing.
 */

// Display order for the goal-type enum (the DB enum itself is unordered). Only MONTHLY_TARGET is
// writable from the Goals panel today; the other two are reserved for the runway/savings goals the
// feature anticipates, and are kept here so the value set has exactly one source of truth.
export const INCOME_GOAL_TYPES = [
  IncomeGoalType.MONTHLY_TARGET,
  IncomeGoalType.RUNWAY_MONTHS,
  IncomeGoalType.SAVINGS_TARGET,
] as const satisfies readonly IncomeGoalType[];

export const INCOME_GOAL_TYPE_LABELS: Record<IncomeGoalType, string> = {
  MONTHLY_TARGET: "Monthly income goal",
  RUNWAY_MONTHS: "Runway goal",
  SAVINGS_TARGET: "Savings goal",
};

// Decimal(10,2) ceiling — the largest value the column can store. Validated up front so a caller
// never hits a raw DB numeric-overflow error (which would surface as a 500 rather than a 422).
export const MAX_GOAL_AMOUNT = 99_999_999.99;

/**
 * How far below the trailing monthly average the latest verified month has to fall before the panel
 * raises an in-app dip alert. A fixed rule of thumb, not a user setting — see
 * lib/goal-calculators.ts's computeDipAlert.
 */
export const DIP_THRESHOLD_PCT = 20;

// A positive money amount with at most 2 decimal places, within the Decimal(10,2) range. The
// 2-decimal check is float-safe (compares cents, not a raw modulo) so 19.99 passes but 19.999 does
// not. Mirrors lib/expenses.ts's amountSchema — a goal of $0 is a cleared goal, not a target, so
// zero is rejected here and "clear" goes through DELETE instead.
const positiveAmountSchema = z
  .number()
  .refine((n) => Number.isFinite(n), { message: "Amount must be a number" })
  .refine((n) => n > 0, { message: "Amount must be greater than 0" })
  .refine((n) => n <= MAX_GOAL_AMOUNT, { message: "Amount is too large" })
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  });

// The two optional planning inputs. Unlike the target, 0 is meaningful here (a user with no cash
// buffer legitimately has $0 on hand), so these allow zero. `null` clears the stored value and
// hands the figure back to its fallback (logged expenses, or "not shown" for cash on hand).
const optionalAmountSchema = z
  .number()
  .refine((n) => Number.isFinite(n), { message: "Amount must be a number" })
  .refine((n) => n >= 0, { message: "Amount can't be negative" })
  .refine((n) => n <= MAX_GOAL_AMOUNT, { message: "Amount is too large" })
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
    message: "Amount can have at most 2 decimal places",
  })
  .nullable();

const goalTypeSchema = z.enum(INCOME_GOAL_TYPES);

/**
 * Body of `POST /api/goals`, which upserts the caller's single goal of this `type` (see the
 * IncomeGoal model's cardinality note). This is a *full* write of the resource: an omitted optional
 * field is stored as null, exactly as if it were passed as null — so re-setting a previously cleared
 * goal can never silently resurrect stale expense/cash figures. Partial edits go through
 * `PATCH /api/goals/[id]` instead.
 *
 * `type` accepts the full enum, but only MONTHLY_TARGET has defined semantics today — it's the only
 * type the Goals panel writes and the only one the dashboard reads. A caller can store one of the
 * other two; it is their own row (the userId in the upsert key is resolved from the session, never
 * from the body, so this can't reach another user's data) and nothing renders it. Narrow this to
 * `z.literal("MONTHLY_TARGET")` if the reserved types are ever dropped rather than built out.
 */
export const upsertGoalSchema = z.object({
  type: goalTypeSchema,
  targetAmount: positiveAmountSchema,
  monthlyExpenses: optionalAmountSchema.optional(),
  cashOnHand: optionalAmountSchema.optional(),
});

// Every field optional (a partial update), but the request must change *something* — an empty body
// is a 422, not a silent no-op. `type` is deliberately absent: retyping a goal would collide with
// the (userId, type) uniqueness rule, so switching type means creating that type's own goal.
export const updateGoalSchema = z
  .object({
    targetAmount: positiveAmountSchema,
    monthlyExpenses: optionalAmountSchema,
    cashOnHand: optionalAmountSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update",
  });

export type UpsertGoalInput = z.infer<typeof upsertGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

/**
 * Serialized goal as returned by the API and consumed by the client. The money fields are numbers
 * (the Decimals are converted server-side via `.toNumber()`) and the timestamps are ISO strings, so
 * the shape is JSON-serializable across the RSC → client boundary.
 */
export type IncomeGoalDto = {
  id: string;
  type: IncomeGoalType;
  targetAmount: number;
  monthlyExpenses: number | null;
  cashOnHand: number | null;
  createdAt: string;
  updatedAt: string;
};

export type { IncomeGoalType };
