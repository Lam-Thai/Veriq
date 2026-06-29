const MONTHLY_BARS = [
  { month: "Jan", heightPct: 58 },
  { month: "Feb", heightPct: 64 },
  { month: "Mar", heightPct: 70 },
  { month: "Apr", heightPct: 66 },
  { month: "May", heightPct: 78 },
  { month: "Jun", heightPct: 100 },
];

type StatTile = {
  label: string;
  value: string;
  detail: string;
};

const STAT_TILES: StatTile[] = [
  { label: "Verified · 6 mo", value: "$63,180", detail: "7 sources" },
  { label: "This month", value: "$11,240", detail: "+14% vs. May" },
  { label: "Verification", value: "98/100", detail: "Excellent" },
];

/**
 * The "Overview" tab content for the product dashboard mockup — browser chrome, three stat
 * tiles, and a monthly income bar chart. This is the only tab with real content per the
 * design spec; other tabs render a lightweight placeholder.
 */
export function DashboardOverviewMockup() {
  return (
    <div className="mx-auto w-full max-w-4xl rounded-lg bg-white shadow-(--shadow-product)">
      <div className="flex items-center gap-2 rounded-t-lg border-b border-hairline px-4 py-3">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
          <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
          <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
        </span>
        <span className="ml-2 truncate text-(length:--type-fine-print-size) text-ink-muted-48">
          app.veriq.com/overview
        </span>
      </div>

      <div className="p-6 sm:p-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {STAT_TILES.map((tile) => (
            <div key={tile.label} className="rounded-md border border-hairline p-4">
              <p className="text-(length:--type-fine-print-size) text-ink-muted-48">{tile.label}</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{tile.value}</p>
              <p className="mt-1 text-(length:--type-fine-print-size) text-verified">{tile.detail}</p>
            </div>
          ))}
        </div>

        <div className="mt-8">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-(length:--type-caption-size) font-semibold text-ink">Monthly income</p>
            <span className="text-(length:--type-fine-print-size) text-ink-muted-48">All sources</span>
          </div>
          <div className="flex h-36 items-end gap-3">
            {MONTHLY_BARS.map((bar) => (
              <div
                key={bar.month}
                className={
                  bar.month === "Jun" ? "flex-1 rounded-t-xs bg-primary" : "flex-1 rounded-t-xs bg-primary/25"
                }
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
      </div>
    </div>
  );
}
