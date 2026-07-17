import { CheckBadgeIcon, CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

type IncomeSourceRow = {
  name: string;
  amount: string;
};

const INCOME_BY_SOURCE: IncomeSourceRow[] = [
  { name: "Stripe", amount: "$18,420.00" },
  { name: "Upwork", amount: "$12,960.00" },
  { name: "Airbnb", amount: "$11,200.00" },
  { name: "Uber", amount: "$8,980.00" },
  { name: "DoorDash", amount: "$7,340.00" },
  { name: "PayPal", amount: "$4,280.00" },
];

/**
 * The report section's focal artifact: a static preview of the lender-ready PDF. Pure
 * presentation — this is the system's other product-imagery mockup, so it carries the
 * single shared elevation shadow. Rests at a slight opposing 3D tilt to the hero mockup and
 * straightens on hover.
 */
export function ReportMockup() {
  return (
    <div className="w-full max-w-md [perspective:1600px]">
      <div
        className={cn(
          "rounded-lg bg-white p-6 shadow-(--shadow-product) sm:p-8",
          "[transform:rotateX(3deg)_rotateY(4deg)] transition-transform duration-(--duration-slow) ease-(--ease-out)",
          "hover:[transform:rotateX(0deg)_rotateY(0deg)] motion-reduce:transition-none",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <CheckBadgeIcon className="h-6 w-6 shrink-0 text-primary" />
            <div>
              <p className="text-(length:--type-caption-size) font-semibold text-ink">
                Verified Income Report
              </p>
              <p className="text-(length:--type-fine-print-size) text-ink-muted-48">
                Veriq · verify.veriq.com
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-verified-surface px-2.5 py-1 text-(length:--type-fine-print-size) font-semibold text-verified">
            <CheckIcon className="h-3 w-3" />
            Verified
          </span>
        </div>

        <p className="mt-6 text-(length:--type-tagline-size)/(--type-tagline-lh) font-semibold text-ink">
          Jordan Reyes
        </p>
        <p className="mt-1 text-(length:--type-caption-size) text-ink-muted-48">
          Jan – Jun 2026 · 6 sources · Generated Jun 23, 2026
        </p>

        <div className="mt-6 border-t border-divider-soft pt-6">
          <p className="text-(length:--type-fine-print-size) text-ink-muted-48">
            Total verified income
          </p>
          <p className="mt-1 text-3xl font-semibold text-ink">$63,180.00</p>
        </div>

        <div className="mt-6 border-t border-divider-soft pt-6">
          <p className="text-(length:--type-fine-print-size) font-semibold tracking-(--type-fine-print-ls) text-ink-muted-48 uppercase">
            Income by source
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {INCOME_BY_SOURCE.map((row) => (
              <li
                key={row.name}
                className="flex items-center justify-between text-(length:--type-caption-size) text-ink"
              >
                <span>{row.name}</span>
                <span className="font-semibold">{row.amount}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-divider-soft pt-4">
          <p className="text-(length:--type-body-size) font-semibold text-ink">Total verified</p>
          <p className="text-(length:--type-body-size) font-semibold text-ink">$63,180.00</p>
        </div>

        <div className="mt-6 rounded-md bg-verified-surface p-4">
          <p className="text-(length:--type-caption-size) font-semibold text-verified">
            Verification certificate
          </p>
          <p className="mt-1 text-(length:--type-fine-print-size) text-ink-muted-80">
            Each deposit verified against its originating source. Authenticate at
            verify.veriq.com/8K2P-DX4
          </p>
        </div>
      </div>
    </div>
  );
}
