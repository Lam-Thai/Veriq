import { CheckIcon } from "@/components/ui/icons";
import { BrowserChrome } from "@/components/ui/browser-chrome";
import { MonthlyBarChart } from "@/components/ui/monthly-bar-chart";
import { cn } from "@/lib/cn";

type ConnectedSource = {
  name: string;
};

const CONNECTED_SOURCES: ConnectedSource[] = [
  { name: "Stripe" },
  { name: "Uber" },
  { name: "Upwork" },
  { name: "DoorDash" },
];

/**
 * The hero's single focal artifact: a browser-chrome dashboard mockup. Pure presentation —
 * no live data, no interactivity. This is the one place in the hero that gets the system's
 * single product-imagery shadow. Rests at a slight 3D tilt (perspective on the outer wrapper,
 * rotateX/rotateY on the shadowed surface) and straightens on hover.
 */
export function HeroMockup() {
  return (
    <div className="mx-auto w-full max-w-3xl [perspective:1600px]">
      <div
        className={cn(
          "rounded-lg bg-white shadow-(--shadow-product)",
          "[transform:rotateX(3deg)_rotateY(-4deg)] transition-transform duration-(--duration-slow) ease-(--ease-out)",
          "hover:[transform:rotateX(0deg)_rotateY(0deg)] motion-reduce:transition-none",
        )}
      >
        <BrowserChrome url="app.veriq.com / overview" />

        <div className="grid grid-cols-1 gap-6 p-6 sm:grid-cols-[1fr_auto] sm:gap-8 sm:p-8">
          {/* Left: headline figure + chart */}
          <div>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-(length:--type-caption-size) text-ink-muted-48">
                  Verified income · last 6 months
                </p>
                <p className="mt-1 font-(family-name:--font-display) text-3xl font-semibold tracking-(--type-display-lg-ls) text-ink sm:text-4xl">
                  $63,180
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-pill bg-verified-surface px-3 py-1.5 text-(length:--type-fine-print-size) font-semibold text-verified">
                <CheckIcon className="h-3 w-3" />
                Verified
              </span>
            </div>

            {/* Bar chart */}
            <div className="relative">
              <MonthlyBarChart trackHeightClassName="h-32" />

              {/* Floating annotation overlapping the May bar */}
              <div className="absolute -top-2 left-[58%] hidden w-44 -translate-y-full rounded-md border border-hairline bg-white p-2.5 shadow-(--shadow-product) sm:block">
                <p className="flex items-center gap-1.5 text-(length:--type-fine-print-size) font-semibold text-verified">
                  <CheckIcon className="h-3 w-3 shrink-0" />
                  Deposit verified
                </p>
                <p className="mt-0.5 text-(length:--type-fine-print-size) text-ink-muted-48">
                  matched to source
                </p>
              </div>
            </div>
          </div>

          {/* Right: connected sources */}
          <div className="sm:w-44">
            <p className="mb-3 text-(length:--type-fine-print-size) font-semibold text-ink-muted-48">
              Connected sources
            </p>
            <ul className="flex flex-col gap-2.5">
              {CONNECTED_SOURCES.map((source) => (
                <li
                  key={source.name}
                  className="flex items-center justify-between text-(length:--type-caption-size) text-ink"
                >
                  {source.name}
                  <CheckIcon className="h-4 w-4 shrink-0 text-verified" />
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom banner */}
        <div className="flex items-center gap-2 rounded-b-lg bg-verified-surface px-6 py-3">
          <CheckIcon className="h-4 w-4 shrink-0 text-verified" />
          <p className="text-(length:--type-caption-size) font-semibold text-verified">
            Report ready to download
          </p>
        </div>
      </div>
    </div>
  );
}
