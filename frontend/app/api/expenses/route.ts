import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { loggerFor } from "@/lib/logger";
import { db } from "@/lib/db";
import { getInternalUserId } from "@/lib/report-jobs";
import { createExpenseSchema, listExpensesQuerySchema } from "@/lib/expenses";
import { listExpensesForUser, serializeExpense } from "@/lib/expense-data";

// Prisma + Clerk — Node APIs, never Edge.
export const runtime = "nodejs";

// Reads are cheaper than writes; both are per-user (never per-IP — see lib/rate-limit.ts). Same
// single-instance in-memory caveat as every other limiter in this repo.
const READ_LIMIT = 60;
const WRITE_LIMIT = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Lists the signed-in user's expenses — newest expense-date first, keyset-paginated (`?cursor=`,
 * `?limit=`), optionally filtered by `?category=`. Always scoped to the caller's own Clerk session:
 * the userId is resolved from `currentUser()`, never accepted from the request, so there's no way to
 * read another user's expenses (see the security skill's IDOR guidance). A signed-in user who has
 * never written any data (no User row yet) simply has an empty list.
 */
export async function GET(request: Request) {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    const { success, resetAt } = checkRateLimit(`expenses-read:${clerkUser.id}`, READ_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

    const url = new URL(request.url);
    const parsed = listExpensesQuerySchema.safeParse({
      category: url.searchParams.get("category") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return ApiError.unprocessable(parsed.error);

    const userId = await getInternalUserId(clerkUser.id);
    if (!userId) return NextResponse.json({ data: [], meta: { nextCursor: null } });

    const { expenses, nextCursor } = await listExpensesForUser(userId, parsed.data);
    return NextResponse.json({ data: expenses, meta: { nextCursor } });
  } catch (err) {
    log.error({ err }, "[expenses] list failed");
    return ApiError.internal();
  }
}

/**
 * Creates an expense for the signed-in user. Provisions the caller's User row on first write (a user
 * can track expenses before ever connecting a platform) via the same upsert the connect callback
 * uses. The amount is validated to a positive 2-decimal value within the Decimal(10,2) range and
 * stored as a fixed-2 string so no float representation ever reaches the numeric column.
 */
export async function POST(request: Request) {
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

    const parsed = createExpenseSchema.safeParse(body);
    if (!parsed.success) return ApiError.unprocessable(parsed.error);

    const email = clerkUser.primaryEmailAddress?.emailAddress;
    if (!email) {
      log.error({ clerkId: clerkUser.id }, "[expenses] clerk user has no primary email");
      return ApiError.internal();
    }

    const user = await db.user.upsert({
      where: { clerkId: clerkUser.id },
      create: { clerkId: clerkUser.id, email },
      update: {},
      select: { id: true },
    });

    const { amount, category, date, note, deductible } = parsed.data;
    const created = await db.expense.create({
      data: {
        userId: user.id,
        amount: amount.toFixed(2),
        category,
        date: new Date(`${date}T00:00:00.000Z`),
        note: note ?? null,
        deductible: deductible ?? true,
      },
      select: {
        id: true,
        amount: true,
        category: true,
        date: true,
        note: true,
        deductible: true,
        createdAt: true,
      },
    });

    log.info({ expenseId: created.id }, "[expenses] created");
    return NextResponse.json({ data: serializeExpense(created) }, { status: 201 });
  } catch (err) {
    log.error({ err }, "[expenses] create failed");
    return ApiError.internal();
  }
}
