import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ReportBuilder } from "@/components/dashboard/report-builder";
import { findPlatformBySlug } from "@/components/landing/platform-data";
import { getUserConnections } from "@/lib/dashboard-data";
import { getNextReportAvailableAt } from "@/lib/report-jobs";
import { resolveUserPlan } from "@/lib/plan-resolution";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import { cn } from "@/lib/cn";

export default async function ReportPage() {
  const user = await currentUser();
  // layout.tsx already redirects signed-out visitors; this is defensive only.
  if (!user) redirect("/sign-in");

  const connections = await getUserConnections(user.id);
  const sources = connections
    .map((connection) => ({
      slug: connection.slug,
      name: findPlatformBySlug(connection.slug)?.name ?? connection.slug,
      amount: connection.verifiedAmount,
    }))
    .sort((a, b) => b.amount - a.amount);

  const plan = await resolveUserPlan(user.id);
  const nextReportAvailableAt = await getNextReportAvailableAt(user.id);

  return (
    <main className="min-h-screen bg-canvas-parchment px-6 py-16">
      <div className="mx-auto max-w-grid">
        <Link
          href="/dashboard"
          className={cn(
            "text-(length:--type-caption-size) font-semibold text-ink-muted-80",
            "transition-colors duration-(--duration-fast) hover:text-ink",
          )}
        >
          ← Back to dashboard
        </Link>

        <div className="mt-4 text-center">
          <h1 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
            Income report
          </h1>
          <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
            Choose which connected platforms to include, then download your lender-ready PDF.
          </p>
        </div>

        <div className="mt-10">
          <ReportBuilder
            sources={sources}
            reportValidityDays={PLAN_LIMITS[plan].reportValidityDays}
            nextReportAvailableAt={nextReportAvailableAt}
          />
        </div>
      </div>
    </main>
  );
}
