import { Card } from "@/components/ui/card";
import { ShieldIcon } from "@/components/ui/icons";
import { CalcMeter } from "@/components/dashboard/calc-meter";
import type { IncomeStabilityScore, StabilityBand } from "@/lib/income-calculators";

type StabilityScoreCardProps = {
  score: IncomeStabilityScore;
};

const BAND_LABEL: Record<StabilityBand, string> = {
  strong: "Strong",
  solid: "Solid",
  moderate: "Moderate",
  developing: "Developing",
};

/**
 * Feature B of the Calculators tab: a descriptive 0–100 stability score with its three subscores.
 * Derived server-side from lib/income-calculators.ts — the numeric counterpart to the Overview
 * tab's rule-based advisor rating. Deliberately framed as descriptive, never a credit score.
 */
export function StabilityScoreCard({ score }: StabilityScoreCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <ShieldIcon className="h-4 w-4 text-ink-muted-48" />
        <p className="text-(length:--type-caption-size) font-semibold text-ink">Income stability score</p>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <p className="text-3xl font-semibold text-ink">{score.score}</p>
        <p className="text-(length:--type-body-size) text-ink-muted-48">/ 100</p>
        <p className="ml-auto text-(length:--type-caption-size) font-semibold text-verified">
          {BAND_LABEL[score.band]}
        </p>
      </div>

      <dl className="mt-5 flex flex-col gap-4">
        <SubScore label="Consistency" value={score.consistency} hint="How flat income is month to month" />
        <SubScore label="Diversification" value={score.diversification} hint="How spread across sources" />
        <SubScore label="Trend" value={score.trend} hint="Whether income is rising or falling" />
      </dl>

      <p className="mt-5 text-(length:--type-fine-print-size) text-ink-muted-48">
        A descriptive summary of your verified income mix, for your own reference. It is not a credit score or a
        lending decision.
      </p>
    </Card>
  );
}

function SubScore({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-(length:--type-caption-size) font-semibold text-ink">{label}</dt>
        <dd className="text-(length:--type-caption-size) font-semibold text-ink-muted-80">{value}</dd>
      </div>
      <CalcMeter valuePct={value} className="mt-1.5" />
      <p className="mt-1 text-(length:--type-fine-print-size) text-ink-muted-48">{hint}</p>
    </div>
  );
}
