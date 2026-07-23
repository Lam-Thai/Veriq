"use client";

import { cn } from "@/lib/cn";

type CalcFieldProps = {
  id: string;
  label: string;
  /** Raw string value — the parent parses it (see parseNonNegativeAmount) before calculating, so
   *  the field can be cleared mid-edit without snapping back to 0. */
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
};

/**
 * Labeled numeric input shared by the interactive calculator cards (tax-estimator-card.tsx,
 * affordability-card.tsx). Matches the report builder's field treatment — hairline border on
 * `bg-canvas`, primary focus ring — but lifts the focus ring to the wrapper so an adjacent
 * currency/percent affix sits inside the same focus target. Native number spinners are hidden
 * since the affix already signals the unit.
 */
export function CalcField({
  id,
  label,
  value,
  onChange,
  prefix,
  suffix,
  min = 0,
  max,
  step,
  hint,
}: CalcFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-(length:--type-fine-print-size) text-ink-muted-48">
        {label}
      </label>
      <div
        className={cn(
          "mt-1 flex items-center gap-2 rounded-lg border border-hairline bg-canvas px-3 py-2",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary-focus",
        )}
      >
        {prefix ? <span className="text-(length:--type-body-size) text-ink-muted-48">{prefix}</span> : null}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "w-full bg-transparent text-(length:--type-body-size) font-semibold text-ink outline-none",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          )}
        />
        {suffix ? <span className="text-(length:--type-body-size) text-ink-muted-48">{suffix}</span> : null}
      </div>
      {hint ? <p className="mt-1 text-(length:--type-fine-print-size) text-ink-muted-48">{hint}</p> : null}
    </div>
  );
}
