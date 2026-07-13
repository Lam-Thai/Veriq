import Link from "next/link";
import { PillButton } from "@/components/ui/pill-button";
import { DotIcon, ArrowRightIcon } from "@/components/ui/icons";
import { HeroMockup } from "@/components/landing/hero-mockup";

const TRUSTED_SOURCES = ["Uber", "DoorDash", "Airbnb", "Upwork", "Stripe", "Fiverr"];

// Hierarchy: trust badge → H1 → subhead → CTAs → product mockup → trusted-by row
export function Hero() {
  return (
    <section id="why-veriq" className="bg-surface-tile-1 px-6 py-(--spacing-section)">
      <div className="mx-auto flex max-w-text flex-col items-center text-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-pill bg-(--color-chip-translucent-64) px-4 py-2 text-(length:--type-caption-size) text-ink">
          <DotIcon className="h-1.5 w-1.5 text-primary" />
          Accepted by lenders, landlords &amp; mortgage brokers
        </span>

        <h1 className="text-(length:--type-hero-display-size)/(--type-hero-display-lh) tracking-(--type-hero-display-ls) font-semibold text-white">
          Income verification built for gig workers
        </h1>

        <p className="mt-6 max-w-2xl text-(length:--type-lead-size)/(--type-lead-lh) tracking-(--type-lead-ls) font-normal text-body-muted">
          Connect your earnings across platforms and generate lender-ready proof of income in
          minutes.
        </p>

        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <PillButton as={Link} href="/dashboard/report" variant="primary">
            Generate My Report
            <ArrowRightIcon className="h-4 w-4" />
          </PillButton>
          <PillButton as="a" href="#the-report" variant="secondary-dark">
            See Sample Report
          </PillButton>
        </div>
      </div>

      <div className="mx-auto mt-16 max-w-grid">
        <HeroMockup />
      </div>

      <div className="mx-auto mt-16 max-w-text text-center">
        <p className="text-(length:--type-fine-print-size) font-semibold tracking-(--type-fine-print-ls) text-ink-muted-48 uppercase">
          Trusted to verify income from
        </p>
        <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
          {TRUSTED_SOURCES.map((source) => (
            <li
              key={source}
              className="text-(length:--type-tagline-size) font-semibold text-body-muted"
            >
              {source}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
