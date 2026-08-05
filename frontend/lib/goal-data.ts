import "server-only";
import { db } from "@/lib/db";
import type { IncomeGoalDto, IncomeGoalType } from "@/lib/goals";

// Shared select — never returns full model rows (see the prisma skill). The Decimals stay Decimals
// until serializeGoal converts them, so cents never round-trip through a float in the DB layer.
// Exported so the item route ([id]/route.ts) reuses the exact same field set — one field added to
// IncomeGoal can't drift between two copies.
export const GOAL_SELECT = {
  id: true,
  type: true,
  targetAmount: true,
  monthlyExpenses: true,
  cashOnHand: true,
  createdAt: true,
  updatedAt: true,
} as const;

type DecimalLike = { toNumber: () => number };

type GoalRow = {
  id: string;
  type: IncomeGoalType;
  targetAmount: DecimalLike;
  monthlyExpenses: DecimalLike | null;
  cashOnHand: DecimalLike | null;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeGoal(row: GoalRow): IncomeGoalDto {
  return {
    id: row.id,
    type: row.type,
    targetAmount: row.targetAmount.toNumber(),
    monthlyExpenses: row.monthlyExpenses?.toNumber() ?? null,
    cashOnHand: row.cashOnHand?.toNumber() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The caller's own active (non-cleared) goals, newest first. Always scoped to `userId` (the caller's
 * internal id, resolved from their Clerk session — never accepted from the request) plus
 * `deletedAt: null`, the same IDOR-safe, soft-delete-aware filter every list query in this repo
 * uses. Bounded by the (userId, type) unique constraint to at most one row per goal type.
 */
export async function listGoalsForUser(userId: string): Promise<IncomeGoalDto[]> {
  const rows = await db.incomeGoal.findMany({
    where: { userId, deletedAt: null },
    select: GOAL_SELECT,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(serializeGoal);
}

/**
 * The caller's active goal of one type, or null. Used by the dashboard page to hand the Goals panel
 * its single monthly-income goal without shipping the whole list.
 */
export async function getGoalForUser(userId: string, type: IncomeGoalType): Promise<IncomeGoalDto | null> {
  const row = await db.incomeGoal.findFirst({
    where: { userId, type, deletedAt: null },
    select: GOAL_SELECT,
  });

  return row ? serializeGoal(row) : null;
}
