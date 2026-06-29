import { CheckIcon } from "@/components/ui/icons";

type ConnectedSource = {
  name: string;
};

const CONNECTED_SOURCES: ConnectedSource[] = [
  { name: "Stripe" },
  { name: "Uber" },
  { name: "Upwork" },
  { name: "DoorDash" },
];

// Jan–Jun, relative bar heights (percent of track) — June is the "current" highlighted month.
const MONTHLY_BARS = [
  { month: "Jan", heightPct: 58 },
  { month: "Feb", heightPct: 64 },
  { month: "Mar", heightPct: 70 },
  { month: "Apr", heightPct: 66 },
  { month: "May", heightPct: 78 },
  { month: "Jun", heightPct: 100 },
];

/**
 * The hero's single focal artifact: a browser-chrome dashboard mockup. Pure presentation —
 * no live data, no interactivity. This is the one place in the hero that gets the system's
 * single product-imagery shadow.
 */
export function HeroMockup() {
  return (
    <div className="mx-auto w-full max-w-3xl rounded-lg bg-white shadow-(--shadow-product)">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 rounded-t-lg border-b border-hairline px-4 py-3">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
          <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
          <span className="h-2.5 w-2.5 rounded-full bg-hairline" />
        </span>
        <span className="ml-2 truncate text-(length:--type-fine-print-size) text-ink-muted-48">
          app.veriq.com / overview
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 p-6 sm:grid-cols-[1fr_auto] sm:gap-8 sm:p-8">
        {/* Left: headline figure + chart */}
        <div>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-(length:--type-caption-size) text-ink-muted-48">
                Verified income · last 6 months
              </p>
              <p className="mt-1 text-3xl font-semibold tracking-(--type-display-lg-ls) text-ink sm:text-4xl">
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
            <div className="flex h-32 items-end gap-3">
              {MONTHLY_BARS.map((bar) => (
                <div key={bar.month} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className={
                      bar.month === "Jun"
                        ? "w-full rounded-t-xs bg-primary"
                        : "w-full rounded-t-xs bg-primary/25"
                    }
                    style={{ height: `${bar.heightPct}%` }}
                  />
                  <span className="text-(length:--type-fine-print-size) text-ink-muted-48">
                    {bar.month}
                  </span>
                </div>
              ))}
            </div>

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
  );
}
