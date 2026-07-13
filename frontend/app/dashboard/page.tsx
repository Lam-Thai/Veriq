import { redirect } from "next/navigation";
import { UserButton, UserProfile } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { BrandLogo } from "@/components/ui/brand-logo";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { OverviewPanel } from "@/components/dashboard/overview-panel";
import { ReportPanel } from "@/components/dashboard/report-panel";
import { getUserConnections, computeDashboardStats } from "@/lib/dashboard-data";

export default async function DashboardPage() {
  const user = await currentUser();
  // proxy.ts already gates /dashboard behind Clerk auth; this is defensive only.
  if (!user) redirect("/sign-in");

  const displayName = user.firstName ?? user.primaryEmailAddress?.emailAddress ?? "there";

  const connections = await getUserConnections(user.id);
  const stats = computeDashboardStats(connections);
  const connectedSlugs = connections.map((connection) => connection.slug);

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-surface-black">
        <div className="mx-auto flex h-14 max-w-grid items-center justify-between px-6">
          <BrandLogo href="/" />

          <UserButton />
        </div>
      </header>

      <main className="min-h-screen bg-canvas-parchment px-6 py-16">
        <div className="mx-auto max-w-grid text-center">
          <h1 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
            Welcome, {displayName}
          </h1>
        </div>

        <div className="mt-10">
          <DashboardShell
            overview={<OverviewPanel stats={stats} connectedSlugs={connectedSlugs} />}
            report={<ReportPanel hasConnections={connections.length > 0} />}
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
