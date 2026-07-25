import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { WalletIcon } from "@/components/ui/icons";
import { CalcMeter } from "@/components/dashboard/calc-meter";
import { formatSignedPercent, formatUsd } from "@/components/dashboard/calc-format";
import type { IncomeProjection } from "@/lib/income-calculators";

// Plain-language explanation of how this projection is produced. Honest that it's a straight
// projection of verified income, never a prediction — mirrors the card's own disclaimer.
const HOW_WE_CALCULATED =
  "We take your verified monthly income, average it out, and multiply by twelve to show what a full " +
  "year at that pace would look like. We also show how your latest month compares to the one before, " +
  "and split your income by source so you can see where it comes from. It's a projection of what " +
  "you've earned so far, not a prediction of future earnings.";

type IncomeProjectionCardProps = {
  projection: IncomeProjection;
};

/**
 * Feature A of the Calculators tab: annualizes the verified monthly average, surfaces month-over-
 * month movement, and breaks income down by source. All values are derived server-side from the
 * projection already computed in lib/income-calculators.ts — no user input, no client state.
 */
export function IncomeProjectionCard({ projection }: IncomeProjectionCardProps) {
  const { annualizedIncome, averageMonthly, latestMonthGrowthPct, averageMonthlyGrowthPct, contributions } =
    projection;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <WalletIcon className="h-4 w-4 text-ink-muted-48" />
        <p className="text-(length:--type-caption-size) font-semibold text-ink">Income projection</p>
      </div>

      <div className="mt-4">
        <p className="text-(length:--type-fine-print-size) text-ink-muted-48">Annualized income</p>
        <p className="mt-1 text-3xl font-semibold text-ink">{formatUsd(annualizedIncome)}</p>
        <p className="mt-1 text-(length:--type-fine-print-size) text-ink-muted-48">
          Your verified monthly average ({formatUsd(averageMonthly)}) projected over 12 months.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-6">
        <GrowthStat label="Latest month" fraction={latestMonthGrowthPct} />
        <GrowthStat label="Avg. monthly change" fraction={averageMonthlyGrowthPct} />
      </div>

      {contributions.length > 0 ? (
        <div className="mt-6">
          <p className="text-(length:--type-fine-print-size) text-ink-muted-48">Income by source</p>
          <ul className="mt-3 flex flex-col gap-3">
            {contributions.map((contribution) => (
              <li key={contribution.name}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-(length:--type-caption-size) font-semibold text-ink">
                    {contribution.name}
                  </span>
                  <span className="text-(length:--type-fine-print-size) text-ink-muted-80">
                    {formatUsd(contribution.amount)} · {Math.round(contribution.sharePct)}%
                  </span>
                </div>
                <CalcMeter valuePct={contribution.sharePct} className="mt-1.5" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Disclosure className="mt-4">{HOW_WE_CALCULATED}</Disclosure>

      <p className="mt-4 text-(length:--type-fine-print-size) text-ink-muted-48">
        An informational projection from your verified income, not a guarantee of future earnings.
      </p>
    </Card>
  );
}

function GrowthStat({ label, fraction }: { label: string; fraction: number | null }) {
  const tone = fraction === null || fraction === 0 ? "text-ink" : fraction > 0 ? "text-verified" : "text-danger";

  return (
    <div>
      <p className="text-(length:--type-fine-print-size) text-ink-muted-48">{label}</p>
      <p className={`mt-0.5 text-(length:--type-caption-size) font-semibold ${tone}`}>
        {fraction === null ? "—" : formatSignedPercent(fraction)}
      </p>
    </div>
  );
}
