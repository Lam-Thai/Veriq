// Shared display formatters for the Calculators tab. Pure (Intl only), so both the server-rendered
// cards and the "use client" interactive cards can import them. Estimates are shown to whole
// dollars — they're approximations, and the rounding reinforces that they aren't exact figures.

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatUsd(amount: number): string {
  return USD_WHOLE.format(amount);
}

/** Fraction → signed percent, e.g. 0.12 → "+12%", -0.05 → "-5%". */
export function formatSignedPercent(fraction: number): string {
  const rounded = Math.round(fraction * 100);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

/** Fraction → unsigned percent, e.g. 0.36 → "36%". */
export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
