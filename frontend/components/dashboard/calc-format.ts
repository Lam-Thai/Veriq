// Shared display formatters for the Calculators tab. Pure (Intl only), so both the server-rendered
// cards and the "use client" interactive cards can import them. Estimates are shown to whole
// dollars — they're approximations, and the rounding reinforces that they aren't exact figures.

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const USD_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(amount: number): string {
  return USD_WHOLE.format(amount);
}

/**
 * Exact money formatter (always two decimals) for *stored* amounts, which — unlike the derived
 * estimates `formatUsd` renders — can legitimately be under a dollar (a $0.40 platform fee). Whole-
 * dollar rounding would collapse those to "$0"; this never does.
 */
export function formatUsdExact(amount: number): string {
  return USD_CENTS.format(amount);
}

/**
 * Whole-dollar formatter for derived estimates that still guarantees a real non-zero value is never
 * shown as "$0": a magnitude that would round to zero (|amount| < 0.5) falls back to cents. Exact
 * zero still renders "$0" — that's a true zero, not a rounded-away value.
 */
export function formatUsdSafe(amount: number): string {
  if (amount !== 0 && Math.abs(amount) < 0.5) return USD_CENTS.format(amount);
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
