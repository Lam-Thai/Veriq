"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { HomeIcon } from "@/components/ui/icons";
import { CalcField } from "@/components/dashboard/calc-field";
import { formatPercent, formatUsd } from "@/components/dashboard/calc-format";
import { computeAffordability, parseNonNegativeAmount, type DtiBand } from "@/lib/income-calculators";

type AffordabilityCardProps = {
  /** Verified average monthly income used as the gross-income base for DTI. */
  monthlyIncome: number;
};

const DTI_BAND_LABEL: Record<DtiBand, string> = {
  healthy: "Healthy",
  moderate: "Moderate",
  elevated: "Elevated",
  high: "High",
};

// Green for the two comfortable bands, amber-ish "ink" for the rest — kept to existing tokens
// (no new colors) so the DTI figure never reads as a hard pass/fail verdict.
const DTI_BAND_TONE: Record<DtiBand, string> = {
  healthy: "text-verified",
  moderate: "text-verified",
  elevated: "text-ink",
  high: "text-danger",
};

/**
 * Feature D of the Calculators tab: an interactive debt-to-income and rent-affordability helper.
 * Verified monthly income is the fixed gross-income base; the user supplies current debts and an
 * optional planned housing payment. All thresholds (36% DTI, 3× rent) are rules of thumb surfaced
 * for planning — never a pre-qualification or lending decision (see lib/income-calculators.ts).
 */
export function AffordabilityCard({ monthlyIncome }: AffordabilityCardProps) {
  const [debtInput, setDebtInput] = useState("");
  const [housingInput, setHousingInput] = useState("");

  const result = computeAffordability(
    monthlyIncome,
    parseNonNegativeAmount(debtInput),
    parseNonNegativeAmount(housingInput),
  );

  return (
    <Card>
      <div className="flex items-center gap-2">
        <HomeIcon className="h-4 w-4 text-ink-muted-48" />
        <p className="text-(length:--type-caption-size) font-semibold text-ink">Affordability &amp; DTI</p>
      </div>

      <p className="mt-3 text-(length:--type-fine-print-size) text-ink-muted-48">
        Based on your verified monthly income of {formatUsd(result.monthlyIncome)}.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <CalcField
          id="dti-debt"
          label="Monthly debt payments"
          value={debtInput}
          onChange={setDebtInput}
          prefix="$"
          step={50}
          hint="Loans, cards, etc."
        />
        <CalcField
          id="dti-housing"
          label="Planned housing (optional)"
          value={housingInput}
          onChange={setHousingInput}
          prefix="$"
          step={50}
          hint="Rent or mortgage."
        />
      </div>

      <div className="mt-5 flex items-baseline gap-2">
        <p className="text-(length:--type-fine-print-size) text-ink-muted-48">Debt-to-income</p>
        {result.dtiRatio === null ? (
          <p className="text-(length:--type-body-size) font-semibold text-ink">—</p>
        ) : (
          <>
            <p className="text-3xl font-semibold text-ink">{formatPercent(result.dtiRatio)}</p>
            {result.dtiBand ? (
              <p className={`ml-auto text-(length:--type-caption-size) font-semibold ${DTI_BAND_TONE[result.dtiBand]}`}>
                {DTI_BAND_LABEL[result.dtiBand]}
              </p>
            ) : null}
          </>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
        <Figure label="Rent at 3× income" value={formatUsd(result.maxRentByIncomeRule)} />
        <Figure label="Housing to stay ≤ 36% DTI" value={formatUsd(result.maxHousingPaymentAtThreshold)} />
      </dl>

      <p className="mt-5 text-(length:--type-fine-print-size) text-ink-muted-48">
        These estimates use common rules of thumb for your own planning. They are not a
        pre-qualification, an approval, or a lending decision.
      </p>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-(length:--type-fine-print-size) text-ink-muted-48">{label}</dt>
      <dd className="mt-0.5 text-(length:--type-body-size) font-semibold text-ink">{value}</dd>
    </div>
  );
}
