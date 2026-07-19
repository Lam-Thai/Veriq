import { Card } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { MonthlyBarChart } from "@/components/ui/monthly-bar-chart";
import { ConnectionsPanel } from "@/components/dashboard/connections-panel";
import { AiInsightsCard } from "@/components/dashboard/ai-insights-card";
import { AdvisorInsightsCard } from "@/components/dashboard/advisor-insights-card";
import { toBarHeights, type DashboardStats, type UserConnection } from "@/lib/dashboard-data";

type OverviewPanelProps = {
  stats: DashboardStats;
  connections: UserConnection[];
  connectedSlugs: string[];
};

export function OverviewPanel({ stats, connections, connectedSlugs }: OverviewPanelProps) {
  const bars = toBarHeights(stats.monthlyBreakdown);

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-(length:--type-fine-print-size) text-ink-muted-48">Verified · 6 mo</p>
          <p className="mt-1 text-2xl font-semibold text-ink">
            <AnimatedNumber value={stats.totalVerified} />
          </p>
          <p className="mt-1 text-(length:--type-fine-print-size) text-verified">
            {connectedSlugs.length} {connectedSlugs.length === 1 ? "source" : "sources"}
          </p>
        </Card>
        <Card>
          <p className="text-(length:--type-fine-print-size) text-ink-muted-48">This month</p>
          <p className="mt-1 text-2xl font-semibold text-ink">
            <AnimatedNumber value={stats.thisMonth} />
          </p>
        </Card>
      </div>

      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-(length:--type-caption-size) font-semibold text-ink">Monthly income</p>
          <span className="text-(length:--type-fine-print-size) text-ink-muted-48">All sources</span>
        </div>
        <MonthlyBarChart bars={bars} trackHeightClassName="h-36" />
      </div>

      <div className="mt-8">
        <AiInsightsCard hasConnections={connectedSlugs.length > 0} />
      </div>

      <div className="mt-4">
        <AdvisorInsightsCard connections={connections} stats={stats} />
      </div>

      <div className="mt-10">
        <p className="text-(length:--type-caption-size) font-semibold text-ink">Connected platforms</p>
        <div className="mt-4">
          <ConnectionsPanel initialConnectedSlugs={connectedSlugs} />
        </div>
      </div>
    </div>
  );
}
