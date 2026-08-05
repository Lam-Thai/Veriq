import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { loggerFor } from "@/lib/logger";
import { db } from "@/lib/db";
import { getInternalUserId } from "@/lib/report-jobs";
import { updateGoalSchema } from "@/lib/goals";
import { GOAL_SELECT, serializeGoal } from "@/lib/goal-data";
import type { Prisma } from "@/lib/generated/prisma/client";

// Prisma + Clerk — Node APIs, never Edge.
export const runtime = "nodejs";

const WRITE_LIMIT = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Edits one of the signed-in user's goals (partial — any subset of fields). Ownership is enforced by
 * scoping the write to `{ id, userId, deletedAt: null }` and treating a zero-row result as 404
 * (IDOR-safe: a caller can never learn about, or mutate, another user's goal — the same pattern the
 * expenses item route uses). A cleared (soft-deleted) goal is treated as gone; re-setting one goes
 * through POST /api/goals.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/goals/[id]">) {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    const { success, resetAt } = checkRateLimit(`goals-write:${clerkUser.id}`, WRITE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return ApiError.badRequest("Request body must be valid JSON");
    }

    const parsed = updateGoalSchema.safeParse(body);
    if (!parsed.success) return ApiError.unprocessable(parsed.error);

    const userId = await getInternalUserId(clerkUser.id);
    if (!userId) return ApiError.notFound();

    const { id } = await ctx.params;

    // Only the fields actually present are written — `undefined` is omitted so a partial update never
    // nulls a field the caller didn't mention. An explicit `null` still clears that field.
    const data: Prisma.IncomeGoalUpdateManyMutationInput = {};
    if (parsed.data.targetAmount !== undefined) data.targetAmount = parsed.data.targetAmount.toFixed(2);
    if (parsed.data.monthlyExpenses !== undefined) {
      data.monthlyExpenses = parsed.data.monthlyExpenses === null ? null : parsed.data.monthlyExpenses.toFixed(2);
    }
    if (parsed.data.cashOnHand !== undefined) {
      data.cashOnHand = parsed.data.cashOnHand === null ? null : parsed.data.cashOnHand.toFixed(2);
    }

    const { count } = await db.incomeGoal.updateMany({ where: { id, userId, deletedAt: null }, data });
    if (count === 0) return ApiError.notFound();

    const updated = await db.incomeGoal.findFirst({
      where: { id, userId, deletedAt: null },
      select: GOAL_SELECT,
    });
    if (!updated) return ApiError.notFound();

    log.info({ goalId: id }, "[goals] updated");
    return NextResponse.json({ data: serializeGoal(updated) });
  } catch (err) {
    log.error({ err }, "[goals] update failed");
    return ApiError.internal();
  }
}

/**
 * Clears one of the signed-in user's goals by soft-deleting it (sets `deletedAt`), so it drops out of
 * every read but the row is never hard-destroyed — and setting that goal type again later revives the
 * same row (see POST /api/goals). Ownership-scoped and idempotent-safe: an already-cleared or
 * non-owned id is a 404, never a leak.
 */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/goals/[id]">) {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    const { success, resetAt } = checkRateLimit(`goals-write:${clerkUser.id}`, WRITE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

    const userId = await getInternalUserId(clerkUser.id);
    if (!userId) return ApiError.notFound();

    const { id } = await ctx.params;
    const { count } = await db.incomeGoal.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) return ApiError.notFound();

    log.info({ goalId: id }, "[goals] cleared");
    return NextResponse.json({ data: { id } });
  } catch (err) {
    log.error({ err }, "[goals] clear failed");
    return ApiError.internal();
  }
}
