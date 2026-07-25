"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { DocumentIcon } from "@/components/ui/icons";
import { CalcField } from "@/components/dashboard/calc-field";
import { formatUsd } from "@/components/dashboard/calc-format";
import {
  computeTaxSetAside,
  DEFAULT_TAX_RATE_PCT,
  MAX_TAX_RATE_PCT,
  MIN_TAX_RATE_PCT,
  parseNonNegativeAmount,
} from "@/lib/income-calculators";

// Plain-language explanation of how the set-aside is estimated. Frames it as a budgeting rule of
// thumb driven by the rate the user picks, consistent with the card's "not tax advice" disclaimer.
const HOW_WE_CALCULATED =
  "We take your verified annual income and apply the tax rate you choose to estimate how much to set " +
  "aside, then break that down per year, quarter, and month, along with what's left afterward. Many " +
  "self-employed people set aside somewhere around a quarter to 30% of what they earn. It's a budgeting " +
  "rule of thumb to help you plan ahead, not tax advice or a tax filing.";

type TaxEstimatorCardProps = {
  /** Verified annualized income used as the base for the set-aside. */
  annualIncome: number;
};

/**
 * Feature C of the Calculators tab: an interactive self-employment tax set-aside estimator. The
 * effective rate is the only user input; everything else derives from verified annual income via
 * lib/income-calculators.ts. A planning rule of thumb, explicitly not tax advice.
 */
export function TaxEstimatorCard({ annualIncome }: TaxEstimatorCardProps) {
  const [rateInput, setRateInput] = useState(String(DEFAULT_TAX_RATE_PCT));

  const result = computeTaxSetAside(annualIncome, parseNonNegativeAmount(rateInput));

  return (
    <Card>
      <div className="flex items-center gap-2">
        <DocumentIcon className="h-4 w-4 text-ink-muted-48" />
        <p className="text-(length:--type-caption-size) font-semibold text-ink">Tax set-aside</p>
      </div>

      <div className="mt-4 max-w-40">
        <CalcField
          id="tax-rate"
          label="Effective tax rate"
          value={rateInput}
          onChange={setRateInput}
          suffix="%"
          min={MIN_TAX_RATE_PCT}
          max={MAX_TAX_RATE_PCT}
          step={1}
          hint="Many gig workers set aside ~25–30%."
        />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
        <Figure label="Set aside / year" value={formatUsd(result.annualSetAside)} />
        <Figure label="Set aside / quarter" value={formatUsd(result.quarterlySetAside)} />
        <Figure label="Set aside / month" value={formatUsd(result.monthlySetAside)} />
        <Figure label="After-tax / month" value={formatUsd(result.afterTaxMonthly)} />
      </dl>

      <Disclosure className="mt-5">{HOW_WE_CALCULATED}</Disclosure>

      <p className="mt-5 text-(length:--type-fine-print-size) text-ink-muted-48">
        A planning estimate at {result.ratePct}% to help you budget for taxes. It is not tax advice, a tax
        filing, or a substitute for a tax professional.
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
