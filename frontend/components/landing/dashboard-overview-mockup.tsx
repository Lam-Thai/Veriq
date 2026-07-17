import { BrowserChrome } from "@/components/ui/browser-chrome";
import { MonthlyBarChart } from "@/components/ui/monthly-bar-chart";
import { cn } from "@/lib/cn";

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
    <div className="mx-auto w-full max-w-4xl [perspective:1600px]">
      <div
        className={cn(
          "rounded-lg bg-white shadow-(--shadow-product)",
          "[transform:rotateX(2deg)] transition-transform duration-(--duration-slow) ease-(--ease-out)",
          "hover:[transform:rotateX(0deg)] motion-reduce:transition-none motion-reduce:hover:[transform:rotateX(2deg)]",
        )}
      >
        <BrowserChrome url="app.veriq.com/overview" />

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
            <MonthlyBarChart trackHeightClassName="h-36" />
          </div>
        </div>
      </div>
    </div>
  );
}
