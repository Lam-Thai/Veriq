// Jan–Jun, relative bar heights (percent of track) — June is the "current" highlighted month.
// Shared by the hero and product-dashboard mockups so both tell the same income story.
export const MONTHLY_BARS = [
  { month: "Jan", heightPct: 58 },
  { month: "Feb", heightPct: 64 },
  { month: "Mar", heightPct: 70 },
  { month: "Apr", heightPct: 66 },
  { month: "May", heightPct: 78 },
  { month: "Jun", heightPct: 100 },
];

type MonthlyBarChartProps = {
  /** Height of the bar track, e.g. "h-32" or "h-36". Must be a definite-height utility — the
   * bars use percentage heights, which only resolve against a parent with a definite height. */
  trackHeightClassName: string;
};

export function MonthlyBarChart({ trackHeightClassName }: MonthlyBarChartProps) {
  return (
    <div>
      <div className={`flex ${trackHeightClassName} items-end gap-3`}>
        {MONTHLY_BARS.map((bar) => (
          <div
            key={bar.month}
            className={bar.month === "Jun" ? "flex-1 rounded-t-xs bg-primary" : "flex-1 rounded-t-xs bg-primary/25"}
            style={{ height: `${bar.heightPct}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex gap-3">
        {MONTHLY_BARS.map((bar) => (
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
