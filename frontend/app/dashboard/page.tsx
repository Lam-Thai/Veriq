import { redirect } from "next/navigation";
import { UserProfile } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { OverviewPanel } from "@/components/dashboard/overview-panel";
import { CalculatorsPanel } from "@/components/dashboard/calculators-panel";
import { ExpensesPanel } from "@/components/dashboard/expenses-panel";
import { GoalsPanel } from "@/components/dashboard/goals-panel";
import { ReportPanel } from "@/components/dashboard/report-panel";
import { SharingPanel } from "@/components/dashboard/sharing-panel";
import { getUserConnections, computeDashboardStats } from "@/lib/dashboard-data";
import { listExpensesForUser, getExpenseSummaryForUser } from "@/lib/expense-data";
import { computeExpenseSummary, type ExpenseSummary } from "@/lib/expense-calculators";
import { computeIncomeProjection } from "@/lib/income-calculators";
import { DEFAULT_PAGE_SIZE, type ExpenseDto } from "@/lib/expenses";
import { getGoalForUser } from "@/lib/goal-data";
import { averageMonthlyLoggedExpenses } from "@/lib/goal-calculators";
import type { IncomeGoalDto } from "@/lib/goals";
import {
  getInternalUserId,
  getLastReportValidUntil,
  getReportHistoryForUser,
  type ReportHistoryEntry,
} from "@/lib/report-jobs";
import {
  listSharesForUser,
  MAX_ACTIVE_SHARES_PER_REPORT,
  MAX_SHARE_EXPIRY_DAYS,
  type ReportShareDto,
} from "@/lib/report-shares";
import { resolveUserPlan } from "@/lib/plan-resolution";
import { PLAN_LIMITS } from "@/lib/plan-limits";

export default async function DashboardPage() {
  const user = await currentUser();
  // layout.tsx already redirects signed-out visitors; this is defensive only.
  if (!user) redirect("/sign-in");

  const displayName = user.firstName ?? user.primaryEmailAddress?.emailAddress ?? "there";

  const connections = await getUserConnections(user.id);
  const stats = computeDashboardStats(connections);
  const connectedSlugs = connections.map((connection) => connection.slug);

  const plan = await resolveUserPlan(user.id);
  const limits = PLAN_LIMITS[plan];
  const internalUserId = await getInternalUserId(user.id);
  const [reportHistory, nextReportAvailableAt]: [ReportHistoryEntry[], Date | null] = internalUserId
    ? await Promise.all([
        getReportHistoryForUser(internalUserId, limits.reportValidityDays),
        getLastReportValidUntil(internalUserId, limits),
      ])
    : [[], null];

  // Expenses tab: verified gross income feeds the net-income math; the summary is a trailing-12-month
  // rollup and the list is the first keyset page. Gross figures come from the shared income
  // projection (null before any verified income → treated as 0) rather than re-inlining the
  // annualization formula here. A user with no User row yet has no expenses, so we skip the DB
  // round-trips and hand the panel a zeroed summary.
  const incomeProjection = computeIncomeProjection(stats, connections);
  const expenseIncomeContext = {
    averageMonthlyGross: incomeProjection?.averageMonthly ?? 0,
    annualizedGross: incomeProjection?.annualizedIncome ?? 0,
  };
  // Shares are fetched alongside the expense queries rather than after them — they're independent,
  // so awaiting separately would add a serial DB round-trip to every dashboard render.
  // The Goals tab's monthly-income goal joins the same batch — it's independent of the others, so
  // awaiting it separately would add another serial round-trip to every dashboard render.
  const [expensePage, expenseSummary, initialShares, incomeGoal]: [
    { expenses: ExpenseDto[]; nextCursor: string | null },
    ExpenseSummary,
    ReportShareDto[],
    IncomeGoalDto | null,
  ] = internalUserId
    ? await Promise.all([
        listExpensesForUser(internalUserId, { limit: DEFAULT_PAGE_SIZE }),
        getExpenseSummaryForUser(internalUserId, expenseIncomeContext),
        listSharesForUser(internalUserId),
        getGoalForUser(internalUserId, "MONTHLY_TARGET"),
      ])
    : [{ expenses: [], nextCursor: null }, computeExpenseSummary([], expenseIncomeContext), [], null];

  // Sharing tab: new links always point at the most recent READY report job. reportHistory is
  // already newest-first (getReportHistoryForUser), so the first READY entry is it — no separate
  // query needed. A user with no User row yet has neither a report nor any shares.
  const latestReadyReportJobId = reportHistory.find((entry) => entry.status === "READY")?.id ?? null;

  return (
    <main className="min-h-screen bg-gradient-flow-light px-6 py-16">
      <div className="mx-auto max-w-grid text-center">
        <h1 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
          Welcome, {displayName}
        </h1>
      </div>

      <div className="mt-10">
        <DashboardShell
          overview={
            <OverviewPanel
              stats={stats}
              connections={connections}
              connectedSlugs={connectedSlugs}
              maxPlatforms={limits.maxPlatforms}
            />
          }
          calculators={<CalculatorsPanel stats={stats} connections={connections} />}
          goals={
            <GoalsPanel
              goal={incomeGoal}
              monthlyBreakdown={stats.monthlyBreakdown}
              averageMonthly={stats.averageMonthly}
              hasVerifiedIncome={stats.totalVerified > 0}
              loggedMonthlyExpenses={averageMonthlyLoggedExpenses(expenseSummary)}
            />
          }
          expenses={
            <ExpensesPanel
              initialExpenses={expensePage.expenses}
              initialNextCursor={expensePage.nextCursor}
              summary={expenseSummary}
            />
          }
          report={
            <ReportPanel
              hasConnections={connections.length > 0}
              history={reportHistory}
              nextReportAvailableAt={nextReportAvailableAt}
              reportValidityDays={limits.reportValidityDays}
            />
          }
          sharing={
            <SharingPanel
              latestReadyReportJobId={latestReadyReportJobId}
              initialShares={initialShares}
              maxActiveShares={MAX_ACTIVE_SHARES_PER_REPORT}
              maxShareExpiryDays={MAX_SHARE_EXPIRY_DAYS}
            />
          }
          account={
            <div className="flex justify-center">
              <UserProfile routing="hash" />
            </div>
          }
        />
      </div>
    </main>
  );
}
