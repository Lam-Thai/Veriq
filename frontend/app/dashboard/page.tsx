import { redirect } from "next/navigation";
import { UserProfile } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { OverviewPanel } from "@/components/dashboard/overview-panel";
import { ReportPanel } from "@/components/dashboard/report-panel";
import { getUserConnections, computeDashboardStats } from "@/lib/dashboard-data";
import {
  getInternalUserId,
  getLastReportValidUntil,
  getReportHistoryForUser,
  type ReportHistoryEntry,
} from "@/lib/report-jobs";
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

  return (
    <>
      <DashboardHeader />
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
            report={
              <ReportPanel
                hasConnections={connections.length > 0}
                history={reportHistory}
                nextReportAvailableAt={nextReportAvailableAt}
                reportValidityDays={limits.reportValidityDays}
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
    </>
  );
}
