import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { loggerFor } from "@/lib/logger";
import { db } from "@/lib/db";
import { getInternalUserId } from "@/lib/report-jobs";
import { updateExpenseSchema } from "@/lib/expenses";
import { serializeExpense, EXPENSE_SELECT } from "@/lib/expense-data";
import type { Prisma } from "@/lib/generated/prisma/client";

// Prisma + Clerk — Node APIs, never Edge.
export const runtime = "nodejs";

const WRITE_LIMIT = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Edits one of the signed-in user's expenses (partial — any subset of fields). Ownership is enforced
 * by scoping the write to `{ id, userId, deletedAt: null }` and treating a zero-row result as 404
 * (IDOR-safe: a caller can never learn about, or mutate, another user's expense — see the
 * connections DELETE route for the same pattern). A soft-deleted row is treated as gone.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/expenses/[id]">) {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    const { success, resetAt } = checkRateLimit(`expenses-write:${clerkUser.id}`, WRITE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return ApiError.badRequest("Request body must be valid JSON");
    }

    const parsed = updateExpenseSchema.safeParse(body);
    if (!parsed.success) return ApiError.unprocessable(parsed.error);

    const userId = await getInternalUserId(clerkUser.id);
    if (!userId) return ApiError.notFound();

    const { id } = await ctx.params;

    // Only the fields actually present are written — `undefined` is omitted so a partial update
    // never nulls a field the caller didn't mention. `note: null` (explicit) still clears the note.
    const data: Prisma.ExpenseUpdateManyMutationInput = {};
    if (parsed.data.amount !== undefined) data.amount = parsed.data.amount.toFixed(2);
    if (parsed.data.category !== undefined) data.category = parsed.data.category;
    if (parsed.data.date !== undefined) data.date = new Date(`${parsed.data.date}T00:00:00.000Z`);
    if (parsed.data.note !== undefined) data.note = parsed.data.note;
    if (parsed.data.deductible !== undefined) data.deductible = parsed.data.deductible;

    const { count } = await db.expense.updateMany({
      where: { id, userId, deletedAt: null },
      data,
    });
    if (count === 0) return ApiError.notFound();

    const updated = await db.expense.findFirst({
      where: { id, userId, deletedAt: null },
      select: EXPENSE_SELECT,
    });
    if (!updated) return ApiError.notFound();

    log.info({ expenseId: id }, "[expenses] updated");
    return NextResponse.json({ data: serializeExpense(updated) });
  } catch (err) {
    log.error({ err }, "[expenses] update failed");
    return ApiError.internal();
  }
}

/**
 * Soft-deletes one of the signed-in user's expenses (sets `deletedAt`), so it drops out of every
 * list and total but the row is never hard-destroyed. Ownership-scoped and idempotent-safe: an
 * already-deleted or non-owned id is a 404, never a leak.
 */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/expenses/[id]">) {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    const { success, resetAt } = checkRateLimit(`expenses-write:${clerkUser.id}`, WRITE_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

    const userId = await getInternalUserId(clerkUser.id);
    if (!userId) return ApiError.notFound();

    const { id } = await ctx.params;
    const { count } = await db.expense.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) return ApiError.notFound();

    log.info({ expenseId: id }, "[expenses] soft-deleted");
    return NextResponse.json({ data: { id } });
  } catch (err) {
    log.error({ err }, "[expenses] delete failed");
    return ApiError.internal();
  }
}
