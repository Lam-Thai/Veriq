"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/cn";
import { MONTHLY_BARS, type Bar } from "@/lib/monthly-bars";

type MonthlyBarChartProps = {
  /** Height of the bar track, e.g. "h-32" or "h-36". Must be a definite-height utility — the
   * bars use percentage heights, which only resolve against a parent with a definite height. */
  trackHeightClassName: string;
  /** Defaults to the static MONTHLY_BARS mock curve — pass real per-user data to render actual
   * amounts instead. The last entry is treated as the "current" month and highlighted. */
  bars?: Bar[];
};

export function MonthlyBarChart({ trackHeightClassName, bars = MONTHLY_BARS }: MonthlyBarChartProps) {
  const currentMonth = bars.at(-1)?.month;
  const prefersReducedMotion = useReducedMotion();
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion) return;
    // Bars mount at 0% first, then grow to their real height a frame later — the CSS
    // transition below only animates between two painted states, not an initial one.
    const frame = requestAnimationFrame(() => setHasMounted(true));
    return () => cancelAnimationFrame(frame);
  }, [prefersReducedMotion]);

  const hasGrown = prefersReducedMotion || hasMounted;

  return (
    <div>
      <div className={`flex ${trackHeightClassName} items-end gap-3`}>
        {bars.map((bar) => (
          <div
            key={bar.month}
            className={cn(
              bar.month === currentMonth ? "flex-1 rounded-t-xs bg-primary" : "flex-1 rounded-t-xs bg-primary/25",
              "transition-[height] duration-(--duration-slow) ease-(--ease-out) motion-reduce:transition-none",
            )}
            style={{ height: hasGrown ? `${bar.heightPct}%` : "0%" }}
          />
        ))}
      </div>
      <div className="mt-2 flex gap-3">
        {bars.map((bar) => (
          <span
            key={bar.month}
            className="flex-1 text-center text-(length:--type-fine-print-size) text-ink-muted-48"
          >
            {bar.month}
          </span>
        ))}
      </div>
    </div>
  );
}
