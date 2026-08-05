import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";
import { ApiError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/rate-limit";
import { loggerFor } from "@/lib/logger";
import { db } from "@/lib/db";
import { getInternalUserId } from "@/lib/report-jobs";
import { upsertGoalSchema } from "@/lib/goals";
import { GOAL_SELECT, listGoalsForUser, serializeGoal } from "@/lib/goal-data";

// Prisma + Clerk — Node APIs, never Edge.
export const runtime = "nodejs";

// Reads are cheaper than writes; both are per-user (never per-IP — see lib/rate-limit.ts). Same
// single-instance in-memory caveat as every other limiter in this repo.
const READ_LIMIT = 60;
const WRITE_LIMIT = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Lists the signed-in user's active income goals. Always scoped to the caller's own Clerk session:
 * the userId is resolved from `currentUser()`, never accepted from the request, so there's no way to
 * read another user's goals (see the security skill's IDOR guidance). A signed-in user who has never
 * written any data (no User row yet) simply has an empty list.
 */
export async function GET() {
  const requestId = (await headers()).get("x-request-id") ?? "unknown";
  const log = loggerFor(requestId);

  try {
    const clerkUser = await currentUser();
    if (!clerkUser) return ApiError.unauthorized();

    const { success, resetAt } = checkRateLimit(`goals-read:${clerkUser.id}`, READ_LIMIT, RATE_LIMIT_WINDOW_MS);
    if (!success) return ApiError.tooManyRequests(Math.ceil((resetAt - Date.now()) / 1000));

    const userId = await getInternalUserId(clerkUser.id);
    if (!userId) return NextResponse.json({ data: [] });

    return NextResponse.json({ data: await listGoalsForUser(userId) });
  } catch (err) {
    log.error({ err }, "[goals] list failed");
    return ApiError.internal();
  }
}

/**
 * Sets (creates or replaces) the signed-in user's goal of the given type. Cardinality is one active
 * goal per (userId, type), so this is an upsert on that unique key rather than a create — two
 * concurrent "set goal" requests resolve to one row at the database level instead of racing into
 * duplicates, and re-setting a previously cleared goal revives the same row (`deletedAt: null`).
 *
 * A full write, not a merge: omitted optional fields are stored as null, so a revived goal never
 * inherits stale expense/cash figures. Partial edits belong on PATCH /api/goals/[id].
 *
 * Provisions the caller's User row on first write (a user can set a goal before ever connecting a
 * platform) via the same upsert the connect callback uses. Amounts are validated to the
 * Decimal(10,2) range and stored as fixed-2 strings so no float representation ever reaches the
 * numeric column.
 */
export async function POST(request: Request) {
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

    const parsed = upsertGoalSchema.safeParse(body);
    if (!parsed.success) return ApiError.unprocessable(parsed.error);

    const email = clerkUser.primaryEmailAddress?.emailAddress;
    if (!email) {
      log.error({ clerkId: clerkUser.id }, "[goals] clerk user has no primary email");
      return ApiError.internal();
    }

    const user = await db.user.upsert({
      where: { clerkId: clerkUser.id },
      create: { clerkId: clerkUser.id, email },
      update: {},
      select: { id: true },
    });

    const { type, targetAmount, monthlyExpenses, cashOnHand } = parsed.data;
    const amounts = {
      targetAmount: targetAmount.toFixed(2),
      monthlyExpenses: monthlyExpenses != null ? monthlyExpenses.toFixed(2) : null,
      cashOnHand: cashOnHand != null ? cashOnHand.toFixed(2) : null,
    };

    const goal = await db.incomeGoal.upsert({
      where: { userId_type: { userId: user.id, type } },
      create: { userId: user.id, type, ...amounts },
      update: { ...amounts, deletedAt: null },
      select: GOAL_SELECT,
    });

    log.info({ goalId: goal.id, type }, "[goals] set");
    // 200, not the 201 the expenses POST returns — a deliberate exception to the api-contracts
    // status table, not an oversight. This verb is an upsert against a cardinality-1 resource: the
    // same request creates, updates, or revives the row depending on state the caller neither knows
    // nor controls, so "201 Created" would be a coin flip. 200 is the honest answer for all three.
    return NextResponse.json({ data: serializeGoal(goal) });
  } catch (err) {
    log.error({ err }, "[goals] set failed");
    return ApiError.internal();
  }
}
