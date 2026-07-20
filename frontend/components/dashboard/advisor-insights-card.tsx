import { Card } from "@/components/ui/card";
import { SlidersIcon } from "@/components/ui/icons";
import {
  computeAdvisorInsights,
  type AdvisorInsightsOutput,
  type AdvisorStabilityRating,
  type AdvisorTrendDirection,
} from "@/lib/advisor-insights";
import type { DashboardStats, UserConnection } from "@/lib/dashboard-data";

type AdvisorInsightsCardProps = {
  connections: UserConnection[];
  stats: DashboardStats;
};

const STABILITY_LABEL: Record<AdvisorStabilityRating, string> = {
  stable: "Stable",
  moderate: "Moderate",
  variable: "Variable",
};

const TREND_LABEL: Record<AdvisorTrendDirection, string> = {
  increasing: "Increasing",
  stable: "Steady",
  decreasing: "Decreasing",
};

/**
 * Deterministic counterpart to AiInsightsCard, rendered directly below it. Computed synchronously
 * from the same connections/stats already loaded for this page (see lib/advisor-insights.ts) —
 * no LLM call, no fetch, no loading/error state of its own — so it stays available whenever the
 * AI card's Gemini-backed endpoint degrades.
 */
export function AdvisorInsightsCard({ connections, stats }: AdvisorInsightsCardProps) {
  const insights = computeAdvisorInsights(connections, stats);

  return (
    <Card>
      <div className="flex items-center gap-2">
        <SlidersIcon className="h-4 w-4 text-ink-muted-48" />
        <p className="text-(length:--type-caption-size) font-semibold text-ink">Our advisor insights</p>
      </div>

      <div className="mt-4">{insights ? <PopulatedState insights={insights} /> : <EmptyState />}</div>
    </Card>
  );
}

function EmptyState() {
  return (
    <p className="text-(length:--type-body-size)/(--type-body-lh) text-ink-muted-80">
      Connect a platform on this tab to see a rule-based summary of your verified income.
    </p>
  );
}

function PopulatedState({ insights }: { insights: AdvisorInsightsOutput }) {
  return (
    <div>
      <p className="text-(length:--type-body-size)/(--type-body-lh) text-ink">{insights.narrative}</p>

      <div className="mt-4 flex flex-wrap gap-6">
        <div>
          <p className="text-(length:--type-fine-print-size) text-ink-muted-48">Stability</p>
          <p className="mt-0.5 text-(length:--type-caption-size) font-semibold text-ink">
            {STABILITY_LABEL[insights.stabilityRating]}
          </p>
        </div>
        <div>
          <p className="text-(length:--type-fine-print-size) text-ink-muted-48">Trend</p>
          <p className="mt-0.5 text-(length:--type-caption-size) font-semibold text-ink">
            {TREND_LABEL[insights.trendDirection]}
          </p>
        </div>
      </div>

      <p className="mt-4 text-(length:--type-caption-size) text-ink-muted-80">{insights.diversificationSummary}</p>

      {insights.notableObservations.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5">
          {insights.notableObservations.map((observation, index) => (
            <li key={`${index}-${observation}`} className="text-(length:--type-fine-print-size) text-ink-muted-80">
              {observation}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-4 text-(length:--type-fine-print-size) text-ink-muted-48">
        Rule-based summary computed from your verified connections. Not a credit score or financial advice.
      </p>
    </div>
  );
}
