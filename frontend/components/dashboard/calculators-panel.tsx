import { Card } from "@/components/ui/card";
import { IncomeProjectionCard } from "@/components/dashboard/income-projection-card";
import { StabilityScoreCard } from "@/components/dashboard/stability-score-card";
import { TaxEstimatorCard } from "@/components/dashboard/tax-estimator-card";
import { AffordabilityCard } from "@/components/dashboard/affordability-card";
import { computeIncomeProjection, computeStabilityScore } from "@/lib/income-calculators";
import type { DashboardStats, UserConnection } from "@/lib/dashboard-data";

type CalculatorsPanelProps = {
  stats: DashboardStats;
  connections: UserConnection[];
};

/**
 * "Calculators" tab body. A server component: it computes the two derived calculators
 * (projection, stability) server-side and hands their results to display cards, while the two
 * interactive calculators (tax, affordability) are client components seeded only with the
 * verified income figures they need. Renders an empty state until the user has verified income,
 * matching the Overview insight cards.
 */
export function CalculatorsPanel({ stats, connections }: CalculatorsPanelProps) {
  const projection = computeIncomeProjection(stats, connections);
  const stability = computeStabilityScore(stats, connections);

  // Both are null on exactly the same condition (no verified income), but guarding on both keeps
  // the types non-null below without an assertion.
  if (!projection || !stability) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <h2 className="text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
          No verified income yet
        </h2>
        <p className="mt-2 text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
          Connect a platform on the Overview tab to unlock income projections, a stability score, and the tax and
          affordability calculators.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IncomeProjectionCard projection={projection} />
        <StabilityScoreCard score={stability} />
        <TaxEstimatorCard annualIncome={projection.annualizedIncome} />
        <AffordabilityCard monthlyIncome={projection.averageMonthly} />
      </div>

      <p className="text-center text-(length:--type-fine-print-size) text-ink-muted-48">
        Every figure on this tab is an informational estimate derived from your verified income — not a credit
        score, an approval, a tax filing, or a lending decision.
      </p>
    </div>
  );
}
