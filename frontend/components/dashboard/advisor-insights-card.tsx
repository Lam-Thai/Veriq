import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { SlidersIcon } from "@/components/ui/icons";
import {
  computeAdvisorInsights,
  type AdvisorInsightsOutput,
  type AdvisorStabilityRating,
  type AdvisorTrendDirection,
} from "@/lib/advisor-insights";
import type { DashboardStats, UserConnection } from "@/lib/dashboard-data";

// Plain-language explanation of how this card's summary is produced. Framed as rule-based
// ("we compare/factor in") to stay textually distinct from the AI card per the design system.
// No formulas, raw stats, numbers, or thresholds; the trend caveat hedges honestly as a general
// pattern and never surfaces internal implementation detail — see issue #38.
const HOW_WE_CALCULATED =
  "We compare your monthly totals to see how much they go up and down, and factor in how many " +
  "platforms your income comes from — spreading income across more sources generally counts as " +
  "more diversified. We also compare your most recent months to earlier ones to see whether income " +
  "is trending up, holding steady, or heading down. This is a general pattern based on a limited " +
  "stretch of months, not a guarantee of what happens next.";

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

      <Disclosure className="mt-4">{HOW_WE_CALCULATED}</Disclosure>

      <p className="mt-4 text-(length:--type-fine-print-size) text-ink-muted-48">
        Rule-based summary computed from your verified connections. Not a credit score or financial advice.
      </p>
    </div>
  );
}
